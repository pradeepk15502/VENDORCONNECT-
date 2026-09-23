import type { SVGProps } from "react";

/* Simple 24px stroke icon set drawn for VendorConnect. Decorative by default (aria-hidden);
 * pass `label` to make an icon meaningful to screen readers. */

const P: Record<string, string> = {
  home: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.2-4.2",
  store: "M4 9h16l-1.5-5h-13L4 9Zm0 0v11h16V9M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3m0 0c0 1.7 1.3 3 3 3s3-1.3 3-3m0 0c0 1.7 1.3 3 3 3s2-1.3 2-3M10 20v-5h4v5",
  cart: "M3 4h2.5l2.2 11h10.6L20.5 7H6.4M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c.8-3.5 3.6-5 7-5s6.2 1.5 7 5",
  back: "M15 5l-7 7 7 7",
  chevron: "M9 5l7 7-7 7",
  camera: "M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0M12 18v3",
  pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  phone: "M5 4h4l1.5 4.5-2.3 1.5a11 11 0 0 0 5.8 5.8l1.5-2.3L20 15v4a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z",
  chat: "M4 5h16v11H9l-5 4V5Z",
  directions: "M3 11 21 3l-8 18-2-8-8-2Z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  truck: "M3 6h11v10H3V6Zm11 4h4l3 3v3h-7v-6ZM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  bag: "M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z",
  plus: "M12 5v14M5 12h14",
  box: "M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Zm0 0 8 4.5m0 0 8-4.5M12 12v9",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z",
  logout: "M10 4H5v16h5M14 8l4 4-4 4M18 12H9",
  alert: "M12 3.5 2.5 20h19L12 3.5ZM12 10v4.5m0 2.5v.5",
  offline: "M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3m6 0a10 10 0 0 1 4 2.3M2 9a14.5 14.5 0 0 1 4.3-2.7m5.7-1a14.5 14.5 0 0 1 10 3.7M12 20h.01",
  refresh: "M20 11a8 8 0 0 0-14.3-4.3L4 9m0-5v5h5m-5 4a8 8 0 0 0 14.3 4.3L20 15m0 5v-5h-5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2",
  share: "M16 6l-4-3-4 3m4-3v12M6 11H5v10h14V11h-1",
  shield: "M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6l7-3Zm-3.5 9 2.5 2.5 4.5-4.5",
  orders: "M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21V3Zm3 5h4m-4 4h4",
  power: "M12 3v8m-5.3-4.7a7.5 7.5 0 1 0 10.6 0",
  carrot: "M14.5 9.5 4 20m10.5-10.5c1.5-1.5 1.5-4 0-5.5L16 2.5m-1.5 7c1.5 1.5 4 1.5 5.5 0l1.5-1.5M14.5 9.5 17 12 9 19M8 14l2 2",
  apple: "M12 7c-1.5-1-5-1.5-6.5 1.5S5 16 7.5 19c1.5 1.8 3 1.5 4.5.8 1.5.7 3 1 4.5-.8C19 16 20 11.5 18.5 8.5S13.5 6 12 7Zm0 0c0-2 1-3.5 3-4",
  milk: "M8 3h8v3l2 3v12H6V9l2-3V3Zm-2 8h12",
  basket: "M3 10h18l-2 10H5L3 10Zm4 0 4-6m6 6-4-6M9 14v3m6-3v3",
  bread: "M5 11a4 4 0 0 1 3-7h8a4 4 0 0 1 3 7v9H5v-9Z",
  pill: "M10.5 20.5a5 5 0 0 1-7-7l7-7a5 5 0 0 1 7 7l-7 7Zm-3.5-10.5 7 7",
  shirt: "M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3c0 1.7-1.3 3-4 3S8 4.7 8 3Z",
  shoe: "M3 17V8h5l2 3 5 1.5c3 .8 6 2 6 4.5v1H3Zm0 0h18",
  plug: "M9 3v5m6-5v5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v4",
  pencil: "M4 20l1-4L16 5l3 3L8 19l-4 1Zm10-13 3 3",
};

export type IconName = keyof typeof P;

export function Icon({
  name,
  size = 24,
  label,
  ...rest
}: { name: IconName | string; size?: number; label?: string } & SVGProps<SVGSVGElement>) {
  const d = P[name] ?? P.box;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={d} />
    </svg>
  );
}
