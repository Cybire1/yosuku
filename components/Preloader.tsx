'use client';

import { useEffect, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import styles from './Preloader.module.css';

const LOGO_TEXT = 'YOSUKU';
const FOOTER_LINES = [
  'Prediction markets on Sui.',
  'Oracle-settled. Sub-second finality.',
];

export default function Preloader() {
  const [active, setActive] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const logoCharRefs = useRef<HTMLSpanElement[]>([]);
  const footerLineRefs = useRef<HTMLSpanElement[]>([]);

  useEffect(() => {
    if (sessionStorage.getItem('preloaderShown')) return;
    const frame = requestAnimationFrame(() => {
      setActive(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useGSAP(
    () => {
      if (!active || !progressBarRef.current || !progressRef.current || !rootRef.current) return;

      const logoChars = logoCharRefs.current.slice(0, LOGO_TEXT.length);
      const footerLines = footerLineRefs.current.slice(0, FOOTER_LINES.length);

      gsap.set(logoChars, { xPercent: 100 });
      gsap.set(footerLines, { yPercent: 100 });
      gsap.set(progressBarRef.current, { scaleX: 0.18, scaleY: 0.96 });

      const animateProgress = (duration = 3.5) => {
        const tl = gsap.timeline();
        const steps = 3;
        let current = 0;

        for (let i = 0; i < steps; i += 1) {
          const isFinal = i === steps - 1;
          const next = isFinal ? 1 : Math.min(current + Math.random() * 0.3 + 0.1, 0.9);
          current = next;

          tl.to(progressBarRef.current, {
            scaleX: next,
            duration: duration / steps,
            ease: 'power3.out',
          });
        }

        return tl;
      };

      const tl = gsap.timeline({
        delay: 0.5,
        onComplete: () => {
          sessionStorage.setItem('preloaderShown', '1');
          setActive(false);
        },
      });

      tl.to(logoChars, {
        xPercent: 0,
        stagger: 0.05,
        duration: 1,
        ease: 'power4.inOut',
      })
        .to(
          footerLines,
          {
            yPercent: 0,
            stagger: 0.1,
            duration: 1,
            ease: 'power4.inOut',
          },
          '0.25'
        )
        .add(animateProgress(), '<')
        .to(
          logoChars,
          {
            xPercent: -100,
            stagger: 0.05,
            duration: 1,
            ease: 'power4.inOut',
          },
          '+=0.15'
        )
        .to(
          footerLines,
          {
            yPercent: -100,
            stagger: 0.1,
            duration: 0.5,
            ease: 'power4.inOut',
          },
          '-=0.1'
        )
        .to(
          progressBarRef.current,
          {
            scale: 7,
            duration: 2.6,
            ease: 'power3.inOut',
          },
          '-=0.15'
        )
        .to(
          progressRef.current,
          {
            opacity: 0,
            duration: 0.5,
            ease: 'power3.out',
          },
          '-=0.75'
        )
        .to(
          rootRef.current,
          {
            opacity: 0,
            duration: 0.35,
            ease: 'power2.out',
          },
          '-=0.4'
        );
    },
    { scope: rootRef, dependencies: [active], revertOnUpdate: true }
  );

  if (!active) return null;

  return (
    <div ref={rootRef} className={styles.root}>
      <div ref={progressRef} className={styles.progress}>
        <div className={styles.pillWrap}>
          <div ref={progressBarRef} className={styles.pill} />
        </div>
        <div className={styles.logo}>
          <h1 className={styles.logoText} aria-label={LOGO_TEXT}>
            {LOGO_TEXT.split('').map((char, index) => (
              <span key={`${char}-${index}`} className={styles.charFrame}>
                <span
                  ref={(node) => {
                    if (node) logoCharRefs.current[index] = node;
                  }}
                  className={styles.char}
                >
                  {char}
                </span>
              </span>
            ))}
          </h1>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.footer}>
          {FOOTER_LINES.map((line, index) => (
            <span key={line} className={styles.footerLineFrame}>
              <span
                ref={(node) => {
                  if (node) footerLineRefs.current[index] = node;
                }}
                className={styles.footerLine}
              >
                {line}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
