import Image from "next/image";

import styles from "./infinite-gallery.module.css";

export type EditorialPhoto = {
  src: string;
  alt: string;
  label: string;
};

function EditorialCanvas({
  photos,
  row,
  decorative = false,
}: {
  photos: readonly EditorialPhoto[];
  row: number;
  decorative?: boolean;
}) {
  return (
    <div className={styles.canvas} data-row={row} aria-hidden={decorative || undefined}>
      <span className={styles.word} aria-hidden="true">TRIMMY</span>
      <span className={styles.geometry} aria-hidden="true"><i /><i /><i /></span>
      {photos.map((photo, index) => (
        <figure className={styles.frame} data-index={index} key={`${row}-${photo.src}-${index}`}>
          <Image
            src={photo.src}
            alt={decorative ? "" : photo.alt}
            fill
            sizes="(max-width: 780px) 34vw, 18vw"
          />
        </figure>
      ))}
    </div>
  );
}

export function DualPhotoMarquee({ photos }: { photos: readonly EditorialPhoto[] }) {
  const rows = [photos, [...photos.slice(3), ...photos.slice(0, 3)]] as const;

  return (
    <div className={styles.marquee} aria-label="Фотогалерея мужских и женских работ">
      {rows.map((row, rowIndex) => (
        <div className={styles.marqueeRow} data-row={rowIndex + 1} key={rowIndex}>
          <div className={styles.track}>
            <EditorialCanvas photos={row} row={rowIndex + 1} />
            <EditorialCanvas photos={row} row={rowIndex + 1} decorative />
          </div>
        </div>
      ))}
    </div>
  );
}
