/**
 * Google Drive as a team library host (D157). A Drive file shared as "Anyone with the link" is
 * read through Google's direct-download address, so a team can keep its guide file in Drive.
 * The share link is turned into that address once, when the user subscribes; from then on the
 * library is an ordinary https address with the usual checks (D48) and a fetch-only grant (D80).
 * Google does not document this address (it moved to drive.usercontent.google.com in 2024).
 */

export const DRIVE_DOWNLOAD_HOST = 'drive.usercontent.google.com';
const ID = /^[A-Za-z0-9_-]{10,200}$/;

/** The file id in a Drive share or download link, or null when it is not one. */
export function driveFileId(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname;
  let id: string | null = null;
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    // /file/d/<id>/view, /file/d/<id>/edit, /file/u/0/d/<id>/view
    const m = /\/file\/(?:u\/\d+\/)?d\/([^/]+)/.exec(u.pathname);
    if (m) id = m[1]!;
    // /open?id=<id>, /uc?id=<id>&export=download
    else if (u.pathname === '/open' || u.pathname === '/uc') id = u.searchParams.get('id');
  } else if (host === DRIVE_DOWNLOAD_HOST && u.pathname === '/download') {
    id = u.searchParams.get('id');
  }
  return id && ID.test(id) ? id : null;
}

/** Google's direct download for a public file. `confirm=t` skips the "can't scan this file" page. */
export function driveDownloadUrl(id: string): string {
  return `https://${DRIVE_DOWNLOAD_HOST}/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
}

/** The address Waymark reads: a Drive link becomes its direct download; any other address stays. */
export function libraryAddress(input: string): string {
  const id = driveFileId(input);
  return id ? driveDownloadUrl(id) : input.trim();
}

export function isDriveAddress(url: string): boolean {
  try {
    return new URL(url).hostname === DRIVE_DOWNLOAD_HOST;
  } catch {
    return false;
  }
}
