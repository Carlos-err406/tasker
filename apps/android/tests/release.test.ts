import { expect, it } from "vitest";
// @ts-expect-error Packaging helpers are plain Node ESM.
import { validateAndroidPackage } from "../../../scripts/package-android.mjs";
const valid = {
  badging:
    "package: name='org.tasker.android' versionCode='1001' versionName='0.1.1' platformBuildVersionName='15'",
  certificate: `Signer #1 certificate SHA-256 digest: ${"ab".repeat(32)}\n`,
  expectedCertificate: "ab".repeat(32),
  version: "0.1.1",
};
it("accepts only the production package with the expected version and signing certificate", () => {
  expect(() => validateAndroidPackage(valid)).not.toThrow();
  for (const badging of [
    valid.badging.replace("org.tasker.android", "org.tasker.android.debug"),
    valid.badging.replace("1001", "1"),
    valid.badging.replace("0.1.1", "0.1.0"),
    valid.badging + "\napplication-debuggable\n",
  ]) {
    expect(() => validateAndroidPackage({ ...valid, badging })).toThrow();
  }
  for (const certificate of [
    "",
    valid.certificate.replaceAll("ab", "cd"),
    valid.certificate + valid.certificate.replace("#1", "#2"),
  ]) {
    expect(() => validateAndroidPackage({ ...valid, certificate })).toThrow(
      "certificate mismatch",
    );
  }
});
it("rejects malformed and unsupported versions", () => {
  for (const version of [
    "0.1.1-beta",
    "1.1000.0",
    "1.0.1000",
    "999999.0.0",
    "0.0.0",
  ])
    expect(() => validateAndroidPackage({ ...valid, version })).toThrow();
});
