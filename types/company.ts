export interface Company {
  /** The database uuid. Deep links use `slug`; phase 2's `company_follows` uses this. */
  id: string;
  /** 'nvidia' — the /company/[id] route segment, kept stable across everything. §1.3(c). */
  slug: string;
  name: string;
  /** Real company logo URL or a short monogram fallback. */
  logo: string;
  /** Brand tint used as the fallback background behind the logo. */
  logoColor: string;
  industry: string;
  /** CareerDeck's own follows — every Follow tap. */
  followerCount: number;
  /** The company's LinkedIn audience, a dated snapshot shown until `followerCount` is meaningful. */
  linkedinFollowerCount: number | null;
  /** Open postings right now. Ranks the suggestion rail and sorts company search. */
  openJobCount: number;
  isFollowing: boolean;
}
