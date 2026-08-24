import Image from "next/image";

import styles from "./infinite-gallery.module.css";

export type EditorialPhoto = {
  src: string;
  alt: string;
  label: string;
};

function PhotoGroup({ photos, decorative = false }: { photos: readonly EditorialPhoto[]; decorative?: boolean }) {
  return (
    <div className={styles.group} aria-hidden={decorative || undefined}>
      {photos.map((photo, index) => (
        <figure className={styles.frame} data-size={index % 3 === 1 ? "wide" : "portrait"} key={`${decorative ? "copy" : "source"}-${photo.src}`}>
          <div className={styles.image}>
            <Image src={photo.src} alt={decorative ? "" : photo.alt} fill quality={94} sizes="(max-width: 780px) 72vw, 320px" />
          </div>
          <figcaption>{photo.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export function PhotoMarquee({ photos }: { photos: readonly EditorialPhoto[] }) {
  return (
    <div className={styles.marquee} aria-label="Работы салонов и барбершопов">
      <div className={styles.track}>
        <PhotoGroup photos={photos} />
        <PhotoGroup photos={photos} decorative />
      </div>
    </div>
  );
}
