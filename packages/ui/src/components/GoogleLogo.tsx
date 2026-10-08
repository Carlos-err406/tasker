const googleLogo = new URL("../assets/google-g.svg", import.meta.url).href;

/** Official Google artwork, decorative beside a visible Google label. */
export function GoogleLogo() {
  return (
    <img
      src={googleLogo}
      alt=""
      aria-hidden="true"
      width={20}
      height={20}
      style={{ width: 20, height: 20, flexShrink: 0 }}
    />
  );
}
