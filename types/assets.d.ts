/**
 * Metro bundles `.pdf` as a generic asset (it's in the default assetExts list), the same
 * way it does images — `require('./x.pdf')` resolves to a numeric asset module id at
 * runtime, resolvable to a real URI via expo-asset's Asset.fromModule(). React Native's
 * own types declare this for common image extensions but not for `.pdf`.
 */
declare module '*.pdf' {
  const assetId: number;
  export default assetId;
}
