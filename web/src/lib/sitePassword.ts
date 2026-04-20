const KEY = "va.sitePassword";

export function getSitePassword(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setSitePassword(pw: string): void {
  try {
    localStorage.setItem(KEY, pw);
  } catch {
    /* storage disabled; user will just re-enter each visit */
  }
}

export function clearSitePassword(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
