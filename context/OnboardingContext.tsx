import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { reportError } from '@/lib/observability';
import type { EmploymentType, Seniority } from '@/types';

/**
 * What the user told us before they had an account to tell it to.
 *
 * Onboarding runs *before* sign-up, which is the higher-converting order — by the time
 * someone sees an email field they have already spent three screens on the thing, and
 * abandoning costs them that. The price is that none of their answers have anywhere to
 * live yet: there is no `auth.uid()`, so no `profiles` row and no `user_preferences` row
 * exists to write to.
 *
 * So the answers are buffered here and flushed the moment the account exists — see
 * `flushOnboarding` in lib/api.ts, called from the sign-up screen once `verifyOtp`
 * returns a session. Until then they live in AsyncStorage, which means closing the app
 * halfway through onboarding and coming back does not start over.
 *
 * The draft is cleared after a successful flush, and also on sign-out: a draft belongs to
 * the person who typed it, and the next person on this device is not them.
 */

const STORAGE_KEY = 'careerdeck.onboarding.v1';

/**
 * What the role question captures. One tap sets both where someone is and what they
 * want, which is why it is one screen rather than two.
 */
export type RoleKey = 'student_intern' | 'graduating' | 'recent_grad' | 'working';

export interface RoleOption {
  key: RoleKey;
  label: string;
  /** Seeds `user_preferences.preferred_employment_types`. */
  employmentTypes: EmploymentType[];
  /** What the feed leads with. Phase 5's ranker is the first thing to read it. */
  seniority: Seniority[];
  /** Whether sign-up asks for a school and graduation year. */
  asksSchool: boolean;
}

export const ROLE_OPTIONS: RoleOption[] = [
  {
    key: 'student_intern',
    label: 'Student, looking for an internship',
    employmentTypes: ['Internship'],
    seniority: ['intern'],
    asksSchool: true,
  },
  {
    key: 'graduating',
    label: 'Graduating soon, looking for new-grad roles',
    employmentTypes: ['Full-time', 'Internship'],
    seniority: ['new_grad', 'intern'],
    asksSchool: true,
  },
  {
    key: 'recent_grad',
    label: 'Recent grad, looking for my first full-time',
    employmentTypes: ['Full-time'],
    seniority: ['new_grad'],
    asksSchool: true,
  },
  {
    key: 'working',
    label: 'Already working, looking for what’s next',
    employmentTypes: ['Full-time', 'Contract'],
    seniority: ['mid', 'senior'],
    asksSchool: false,
  },
];

export interface OnboardingDraft {
  role: RoleKey | null;
  /** Sector keys from constants/industries.ts. */
  industries: string[];
  /** Company slugs, written to `company_follows` after sign-up. */
  followedCompanySlugs: string[];
}

const EMPTY_DRAFT: OnboardingDraft = {
  role: null,
  industries: [],
  followedCompanySlugs: [],
};

interface OnboardingState extends OnboardingDraft {
  /** False until the stored draft has been read off disk. */
  isResolved: boolean;
  /** The chosen role's full record, or null before the first screen is answered. */
  roleOption: RoleOption | null;
  setRole: (role: RoleKey) => void;
  toggleIndustry: (key: string) => void;
  toggleCompany: (slug: string) => void;
  /** Wipes the draft. Called after a successful flush, and on sign-out. */
  clear: () => void;
}

const OnboardingContext = createContext<OnboardingState | null>(null);

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_DRAFT);
  const [isResolved, setIsResolved] = useState(false);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!active) return;
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<OnboardingDraft>;
          setDraft({
            role: parsed.role ?? null,
            industries: parsed.industries ?? [],
            followedCompanySlugs: parsed.followedCompanySlugs ?? [],
          });
        }
        setIsResolved(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        // A draft that cannot be read is a draft the user re-enters. Worth reporting,
        // never worth blocking the app on.
        reportError(error, { where: 'onboarding.load' });
        setIsResolved(true);
      });

    return () => {
      active = false;
    };
  }, []);

  // Written on every change rather than at the end of each screen: someone who closes
  // the app on the industries screen should come back to their picks, not to step one.
  useEffect(() => {
    if (!isResolved) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(draft)).catch((error: unknown) => {
      reportError(error, { where: 'onboarding.persist' });
    });
  }, [draft, isResolved]);

  const setRole = useCallback((role: RoleKey) => {
    setDraft((current) => ({ ...current, role }));
  }, []);

  const toggleIndustry = useCallback((key: string) => {
    setDraft((current) => ({ ...current, industries: toggle(current.industries, key) }));
  }, []);

  const toggleCompany = useCallback((slug: string) => {
    setDraft((current) => ({
      ...current,
      followedCompanySlugs: toggle(current.followedCompanySlugs, slug),
    }));
  }, []);

  const clear = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {
      // Nothing to do about it, and the in-memory draft is already gone.
    });
  }, []);

  const value = useMemo<OnboardingState>(
    () => ({
      ...draft,
      isResolved,
      roleOption: ROLE_OPTIONS.find((option) => option.key === draft.role) ?? null,
      setRole,
      toggleIndustry,
      toggleCompany,
      clear,
    }),
    [draft, isResolved, setRole, toggleIndustry, toggleCompany, clear],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingState {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used inside an <OnboardingProvider>.');
  }
  return context;
}
