export interface Company {
  id: string;
  name: string;
  /** Short monogram rendered by <CompanyLogo/>. Swap for a real image URL later. */
  logo: string;
  /** Brand tint used behind the monogram. */
  logoColor: string;
  industry: string;
  followerCount: number;
  isFollowing: boolean;
}
