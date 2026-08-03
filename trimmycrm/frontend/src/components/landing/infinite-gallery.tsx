"use client";

import Image from "next/image";

import styles from "./infinite-gallery.module.css";

export type EditorialPhoto = {
  src: string;
  alt: string;
  label: string;
};

function EditorialSequence({
  photos,
  decorative = false,
  row,
}: {
  photos: readonly EditorialPhoto[];
  decorative?: boolean;
  row: number;
}) {
  return (
    <div className={styles.sequence} data-row={row}>
      {photos.map((photo, index) => (
        <figure className={styles.frame} data-index={index} key={`${photo.src}-${index}`}>
          <Image
            src={photo.src}
            alt={decorative ? "" : photo.alt}
            fill
            sizes="(max-width: 780px) 48vw, 19vw"
          />
        </figure>
      ))}
    </div>
  );
}

export function DualPhotoMarquee({ photos }: { photos: readonly EditorialPhoto[] }) {
  const rows = [photos, [...photos.slice(2), ...photos.slice(0, 2)]] as const;

  return (
    <div className={styles.marquee} aria-label="Фотогалерея мужских и женских работ">
      {rows.map((row, rowIndex) => (
        <div className={styles.marqueeRow} data-row={rowIndex + 1} key={rowIndex}>
          <div className={styles.decor} aria-hidden="true"><i /><i /><i /></div>
          <div className={styles.track}>
            <EditorialSequence photos={row} row={rowIndex + 1} />
            <div aria-hidden="true"><EditorialSequence photos={row} decorative row={rowIndex + 1} /></div>
          </div>
        </div>
      ))}
    </div>
  );
}
