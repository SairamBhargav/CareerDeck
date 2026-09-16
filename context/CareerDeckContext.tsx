import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { mockCompanies } from '@/data/mockCompanies';
import { mockJobs } from '@/data/mockJobs';
import { mockUser } from '@/data/mockUser';
import type { Company, Job, User } from '@/types';

/**
 * Single in-memory store for CareerDeck.
 *
 * Milestone 0 has no backend, so following / liking / saving live here as plain
 * React state and reset when the app restarts. When a real API arrives, only this
 * file needs to change - screens read from the hooks below.
 */

interface CareerDeckState {
  user: User;
  jobs: Job[];
  companies: Company[];
  followedCompanyIds: string[];
  likedJobIds: string[];
  savedJobIds: string[];
  isFollowing: (companyId: string) => boolean;
  isLiked: (jobId: string) => boolean;
  isSaved: (jobId: string) => boolean;
  toggleFollow: (companyId: string) => void;
  toggleLike: (jobId: string) => void;
  toggleSave: (jobId: string) => void;
}

const CareerDeckContext = createContext<CareerDeckState | null>(null);

function toggleInSet(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

function seedFollowedCompanies(): Set<string> {
  return new Set(mockCompanies.filter((company) => company.isFollowing).map((company) => company.id));
}

export function CareerDeckProvider({ children }: { children: ReactNode }) {
  const [followedIds, setFollowedIds] = useState<Set<string>>(seedFollowedCompanies);
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set<string>());
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set<string>());

  const toggleFollow = useCallback((companyId: string) => {
    setFollowedIds((current) => toggleInSet(current, companyId));
  }, []);

  const toggleLike = useCallback((jobId: string) => {
    setLikedIds((current) => toggleInSet(current, jobId));
  }, []);

  const toggleSave = useCallback((jobId: string) => {
    setSavedIds((current) => toggleInSet(current, jobId));
  }, []);

  const value = useMemo<CareerDeckState>(() => {
    const companies = mockCompanies.map((company) => ({
      ...company,
      isFollowing: followedIds.has(company.id),
    }));

    const jobs = mockJobs.map((job) => ({
      ...job,
      isLiked: likedIds.has(job.id),
      isSaved: savedIds.has(job.id),
    }));

    return {
      user: mockUser,
      jobs,
      companies,
      followedCompanyIds: [...followedIds],
      likedJobIds: [...likedIds],
      savedJobIds: [...savedIds],
      isFollowing: (companyId: string) => followedIds.has(companyId),
      isLiked: (jobId: string) => likedIds.has(jobId),
      isSaved: (jobId: string) => savedIds.has(jobId),
      toggleFollow,
      toggleLike,
      toggleSave,
    };
  }, [followedIds, likedIds, savedIds, toggleFollow, toggleLike, toggleSave]);

  return <CareerDeckContext.Provider value={value}>{children}</CareerDeckContext.Provider>;
}

export function useCareerDeck(): CareerDeckState {
  const context = useContext(CareerDeckContext);
  if (!context) {
    throw new Error('useCareerDeck must be used inside a <CareerDeckProvider>.');
  }
  return context;
}
