import { describe, it, expect } from "vitest";
import { parseTags, formatBytes, parsePositiveInt } from "../src/util";

describe("parseTags", () => {
  it("parses multiple key=value pairs", () => {
    expect(parseTags("env=prod,team=infra")).toEqual([
      { key: "env", value: "prod" },
      { key: "team", value: "infra" },
    ]);
  });

  it("trims whitespace and allows '=' inside the value", () => {
    expect(parseTags(" k = a=b ")).toEqual([{ key: "k", value: "a=b" }]);
  });

  it("ignores empty segments", () => {
    expect(parseTags("a=1,,b=2,")).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ]);
  });

  it("returns [] for undefined or empty input", () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags("   ")).toEqual([]);
  });

  it("throws when '=' is missing", () => {
    expect(() => parseTags("bad")).toThrow(/key=value/);
  });

  it("throws when the key is empty", () => {
    expect(() => parseTags("=value")).toThrow(/key=value/);
  });
});

describe("formatBytes", () => {
  it("scales through the binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.50 KiB");
    expect(formatBytes(1024 * 1024)).toBe("1.00 MiB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.00 GiB");
  });

  it("reports unknown for undefined/NaN", () => {
    expect(formatBytes(undefined)).toBe("unknown");
    expect(formatBytes(Number.NaN)).toBe("unknown");
  });
});

describe("parsePositiveInt", () => {
  it("accepts positive integers", () => {
    expect(parsePositiveInt("15", "--poll-interval")).toBe(15);
  });

  it("rejects zero, negatives, fractions and non-numbers", () => {
    expect(() => parsePositiveInt("0", "--x")).toThrow(/positive integer/);
    expect(() => parsePositiveInt("-3", "--x")).toThrow();
    expect(() => parsePositiveInt("1.5", "--x")).toThrow();
    expect(() => parsePositiveInt("abc", "--x")).toThrow();
  });
});
