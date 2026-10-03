import { useState } from 'react';
import { isHttpsImageUrl } from '../domain/remote-image';

/** Decorative beside the existing author label. Anonymous CORS loading omits
 * cross-origin credentials; failure retains the same fixed-size placeholder. */
export function Avatar({ url, author, locale }: { url?: string; author: string; locale: string }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return <div className="avatar" aria-hidden="true">
    {isHttpsImageUrl(url) && failedUrl !== url
      ? <img src={url} alt="" width={32} height={32} loading="lazy" decoding="async"
        referrerPolicy="no-referrer" crossOrigin="anonymous" onError={() => setFailedUrl(url)} />
      : author.slice(0, 1).toLocaleUpperCase(locale)}
  </div>;
}
