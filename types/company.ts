export interface Company {
  id: string;
  name: string;
  /** Real company logo URL or a short monogram fallback. */
  logo: string;
  /** Brand tint used as the fallback background behind the logo. */
  logoColor: string;
  industry: string;
  followerCount: number;
  isFollowing: boolean;
}
