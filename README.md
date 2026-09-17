# CareerDeck

Job discovery that feels like a feed, not a job board.

CareerDeck is a mobile-first app where you swipe vertically through job postings the way you
swipe through TikTok or Reels. Instead of filtering a table of listings, you scroll a
personalized deck of roles, follow the companies you care about, like and save what stands out,
and eventually let CareerDeck help you fill out the application — with you reviewing everything
before anything is submitted.

---

## Current milestone: **Milestone 0 — UI Foundation**

This build is the frontend foundation only. There is **no backend, no authentication, no job
scraping, and no AI auto-apply.** Every job, company, and user record comes from local mock data,
and all interaction state lives in memory (it resets when the app restarts).

### What works today

| Area | Status |
| --- | --- |
| Bottom tab navigation (Home / Reels / Profile) | Working, opens on Home |
| Home dashboard: greeting, name, stats, resume card | Working |
| Suggested companies rail with Follow / Following | Working (local state) |
| "Your Feed" vertical job list with Save | Working |
| Reels: full-screen vertical paging feed | Working |
| Reels: Following / For You toggle with animated indicator | Working |
| Reels: Like, Save, More, Apply action rail | Working |
| Apply bottom sheet with "Review Application" placeholder | Working |
| Job detail modal route | Working |
| Profile placeholder screen | Working |
| Persistence across restarts | Not implemented (by design) |

---

## Tech stack

- **React Native 0.86** on **Expo SDK 57**
- **TypeScript** in strict mode (`noUncheckedIndexedAccess` on)
- **Expo Router** for file-based navigation with typed routes
- **React hooks + a single Context** for state — no Redux, no state library
- **`@expo/vector-icons`** (Ionicons) for iconography
- **`StyleSheet`** with centralized tokens in `constants/theme.ts` — no Tailwind/NativeWind

No UI framework was added. The only dependency installed beyond the Expo template is
`@expo/vector-icons`.

---

## Getting started

Requires Node 20+ and npm.

```bash
npm install
npm start
```

`npm start` prints a QR code and a dev-server URL.

### Run on a physical phone (Expo Go)

1. Install **Expo Go** fro the App Store or Google Play.
2. Make sure your phone and computer are on the **same Wi-Fi network**.
3. Run `npm start`.
4. **iOS:** scan the QR code with the Camera app. **Android:** scan it from inside Expo Go.

If the QR code will not connect (common on university or corporate Wi-Fi), run the tunnel:

```bash
npx expo start --tunnel
```

### Other targets

```bash
npm run ios       # iOS simulator (macOS only)
npm run android   # Android emulator
npm run web       # browser
npm run typecheck # tsc --noEmit
```

---

## Directory structure

```
app/                        Routes (Expo Router — the file tree is the navigation tree)
  _layout.tsx               Root stack + providers (safe area, gestures, CareerDeckProvider)
  (tabs)/
    _layout.tsx             Bottom tab bar: Home, Reels, Profile
    index.tsx               Home dashboard + "Your Feed"
    reels.tsx               Full-screen vertical job feed
    profile.tsx             Profile placeholder
  job/[id].tsx              Job detail, presented as a modal

components/
  common/                   Shared primitives: CompanyLogo, IconButton, PrimaryButton,
                            SectionHeader, SkillChip, EmptyState
  home/                     HomeHeader, StatRow, ResumeCard, CompanySuggestionCard,
                            SuggestedCompanies
  jobs/                     JobPreviewCard, JobMetadata, ApplicationModal
  reels/                    JobReelCard, ReelActionRail, FeedToggle

constants/theme.ts          Colors, spacing, radius, type scale, shadows, screen padding
context/CareerDeckContext.tsx  The single in-memory store
data/                       mockJobs.ts, mockCompanies.ts, mockUser.ts
hooks/useJobFeeds.ts        Derives the For You / Following / Home feeds
types/                      Job, Company, User
utils/format.ts             Salary, relative date, follower count formatting
```

Screens stay thin: they compose components and read from hooks, and none of them own layout for
more than the page scaffold.

---

## Mock-data architecture

Presentation never imports mock data directly. The flow is:

```
data/mock*.ts  →  CareerDeckContext  →  useJobFeeds()  →  screens  →  components
```

- `data/*` holds the raw fixtures and is the only place job/company/user records are declared.
- `CareerDeckContext` is the single source of truth at runtime. It holds three `Set`s
  (followed companies, liked jobs, saved jobs) and merges them onto the mock records, so
  `job.isLiked` and `company.isFollowing` are always current wherever they are read.
- `useJobFeeds()` derives the sorted For You feed, the Following feed (jobs whose company is
  followed), and the suggested-company rail.
- Components receive plain props and callbacks. They do not know where the data came from.

When a real API arrives, `CareerDeckContext` is the only file that has to change.

**Company logos** are currently monograms (`NV`, `G`, `DD`) tinted with a brand color, rendered by
`<CompanyLogo/>`. Swapping in real images means editing that one component.

---

## Design system

All visual values come from `constants/theme.ts` — colors, spacing, radii, type sizes, shadows,
and the shared `screenPadding`. No component hardcodes a hex value.

The palette is deliberately neutral (near-black, warm greys, one accent) so branding can be
changed by editing that file alone. The app shell (Home, Profile) is light; the Reels surface is a
dark immersive treatment with a soft brand-tinted glow behind each job, chosen so job text stays
the highest-contrast thing on screen.

---

## Roadmap

**Milestone 1 — Real data**
- Job and company API layer behind the existing context
- Persistence for follows / likes / saves (AsyncStorage, then server)
- Search and filtering (role, location, work arrangement, salary)

**Milestone 2 — Accounts & profile**
- Authentication and account creation
- Real resume upload and parsing
- Editable profile and job preferences that actually shape the For You feed

**Milestone 3 — Application tracking**
- Application status pipeline (saved → applied → interviewing → offer)
- Apply handoff to the employer's site with tracking
- Notifications for deadlines and status changes

**Milestone 4 — AI-assisted applications**
- Pre-fill application forms from the stored resume and profile
- A required human review step before anything is submitted
- Tailored resume and cover-letter suggestions per posting

**Ongoing**
- Company profile pages and a follow graph
- Feed ranking from likes, saves, and applies
- Onboarding flow

---

## Notes for contributors

- Use `npm run typecheck` before pushing; strict mode is on and `any` is avoided.
- Keep screen files small — extract into `components/<area>/` when a screen grows.
- Add new design values to `constants/theme.ts` rather than inline styles.
- Do not duplicate mock data; add to `data/` and read through the context.
