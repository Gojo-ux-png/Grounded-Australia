export const challengeRequired = (action: string, siteKey: string) => action !== "signIn" || Boolean(siteKey);
