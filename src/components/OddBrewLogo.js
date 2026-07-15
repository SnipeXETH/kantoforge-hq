import React from "react";

// Self-contained "ODD BREW Co" lockup. Everything is drawn with currentColor,
// so it inherits the surrounding text colour — near-white on the dark portal,
// dark on a light background — without needing a separate white asset.
export default function OddBrewLogo({ height = 40, title = "Odd Brew Co" }) {
  const w = (300 / 252) * height;
  return (
    <svg role="img" aria-label={title} viewBox="0 0 300 252" height={height} width={w} style={{ display: "block", color: "currentColor" }}>
      <title>{title}</title>
      <text
        x="150" y="58" textAnchor="middle" textLength="286" lengthAdjust="spacingAndGlyphs"
        fontFamily="'Arial Black','Helvetica Neue',Arial,sans-serif" fontWeight="900" fontSize="72" letterSpacing="1"
        fill="currentColor"
      >ODD BREW</text>
      <g transform="translate(43,86)" fill="currentColor">
        {/* C — a thick ring opening to the right */}
        <path d="M125.58 50.13 A68 68 0 1 0 125.58 133.87 L98.79 112.93 A34 34 0 1 1 98.79 71.07 Z" />
        {/* o — a thick ring set into the C's lower right */}
        <circle cx="170" cy="112" r="27" fill="none" stroke="currentColor" strokeWidth="32" />
      </g>
    </svg>
  );
}
