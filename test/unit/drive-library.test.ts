/** D157: a Google Drive share link as the team library; a web page instead of the file is said plainly. */
import { describe, expect, it } from 'vitest';
import { driveDownloadUrl, driveFileId, isDriveAddress, libraryAddress } from '../../src/core/sharing/drive';
import { fetchLibraryText, libraryUrlAllowed } from '../../src/core/sharing/library';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const DL = `https://drive.usercontent.google.com/download?id=${ID}&export=download&confirm=t`;

describe('Drive links (D157)', () => {
  it('reads the file id from every common share and download link', () => {
    for (const link of [
      `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
      `https://drive.google.com/file/d/${ID}/view?usp=drive_link`,
      `https://drive.google.com/file/d/${ID}/edit`,
      `https://drive.google.com/file/u/0/d/${ID}/view`,
      `https://drive.google.com/open?id=${ID}`,
      `https://drive.google.com/uc?id=${ID}&export=download`,
      `https://drive.google.com/uc?export=download&id=${ID}`,
      `https://docs.google.com/uc?export=download&id=${ID}`,
      `  https://drive.google.com/file/d/${ID}/view  `,
      DL,
    ])
      expect(driveFileId(link), link).toBe(ID);
  });

  it('leaves anything else alone: other hosts, http, folders, odd ids', () => {
    for (const link of [
      `http://drive.google.com/file/d/${ID}/view`,
      `https://drive.google.com.evil.test/file/d/${ID}/view`,
      `https://evil.test/file/d/${ID}/view`,
      'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp',
      'https://drive.google.com/file/d/short/view',
      'https://drive.google.com/open?id=has%20space%20in%20it',
      'https://drive.google.com/open?id=../../etc',
      'not a link',
    ])
      expect(driveFileId(link), link).toBeNull();
  });

  it('a Drive link becomes Google’s direct download; any other address stays as it is', () => {
    expect(libraryAddress(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toBe(DL);
    expect(driveDownloadUrl(ID)).toBe(DL);
    expect(libraryAddress(' https://team.example/guides.waymark.json ')).toBe('https://team.example/guides.waymark.json');
    expect(isDriveAddress(DL)).toBe(true);
    expect(isDriveAddress('https://team.example/x')).toBe(false);
    expect(libraryUrlAllowed(DL)).toBe(true);
  });
});

const answer = (body: string, type: string, status = 200) => (async () => new Response(body, { status, headers: { 'content-type': type } })) as unknown as typeof fetch;

describe('a web page instead of the guide file (D157)', () => {
  it('Drive’s sharing or scan page says how to share the file', async () => {
    await expect(fetchLibraryText(DL, answer('<!doctype html><title>Google Drive</title>', 'text/html; charset=utf-8'))).rejects.toThrow(/Anyone with the link/);
  });
  it('any other site’s web page asks for the file’s own address, even when it claims JSON', async () => {
    await expect(fetchLibraryText('https://team.example/guides', answer('  <html><body>Sign in</body></html>', 'application/json'))).rejects.toThrow(/not a Waymark guide file/);
  });
  it('a missing Drive file says to check the link and sharing', async () => {
    await expect(fetchLibraryText(DL, answer('<html>404</html>', 'text/html', 404))).rejects.toThrow(/Google Drive/);
  });
  it('the guide file itself is read as before', async () => {
    await expect(fetchLibraryText(DL, answer('{"format":"waymark-pack"}', 'application/octet-stream'))).resolves.toBe('{"format":"waymark-pack"}');
  });
});
