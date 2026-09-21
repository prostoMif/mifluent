import { describe, expect, it } from "vitest";
import { describeAddress, isPublicAddress } from "./address-rules.js";

describe("isPublicAddress", () => {
  it("accepts an ordinary public IPv4 address", () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
  });

  it("accepts an ordinary public IPv6 address", () => {
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });

  it("refuses loopback", () => {
    expect(isPublicAddress("127.0.0.1")).toBe(false);
  });

  it("refuses a loopback address that is not 127.0.0.1", () => {
    // The whole of 127/8 is loopback, and a check written as an equality
    // against "127.0.0.1" misses every other address in it.
    expect(isPublicAddress("127.9.9.9")).toBe(false);
  });

  it("refuses IPv6 loopback", () => {
    expect(isPublicAddress("::1")).toBe(false);
  });

  it("refuses the three private IPv4 ranges", () => {
    expect(isPublicAddress("10.0.0.1")).toBe(false);
    expect(isPublicAddress("172.16.0.1")).toBe(false);
    expect(isPublicAddress("192.168.1.1")).toBe(false);
  });

  it("accepts an address just outside the 172.16/12 range", () => {
    // 172.16.0.0–172.31.255.255 is private; 172.32.x.x is not. A check that
    // matched on "172.*" would be wrong in the direction nobody notices.
    expect(isPublicAddress("172.32.0.1")).toBe(true);
  });

  it("refuses the cloud metadata address", () => {
    // 169.254.169.254 on AWS, GCP and Azure hands out instance credentials to
    // anything that asks. This is the single most valuable target of an SSRF.
    expect(isPublicAddress("169.254.169.254")).toBe(false);
  });

  it("refuses carrier-grade NAT", () => {
    expect(isPublicAddress("100.64.0.1")).toBe(false);
  });

  it("refuses IPv6 unique local addresses", () => {
    expect(isPublicAddress("fd00::1")).toBe(false);
  });

  it("refuses IPv6 link-local addresses", () => {
    expect(isPublicAddress("fe80::1")).toBe(false);
  });

  it("refuses an IPv4-mapped IPv6 address", () => {
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:93.184.216.34")).toBe(false);
  });

  it("refuses 6to4 and Teredo addresses", () => {
    expect(isPublicAddress("2002:7f00:1::1")).toBe(false);
    expect(isPublicAddress("2001::1")).toBe(false);
  });

  it("refuses multicast and broadcast", () => {
    expect(isPublicAddress("224.0.0.1")).toBe(false);
    expect(isPublicAddress("255.255.255.255")).toBe(false);
  });

  it("refuses the unspecified address", () => {
    expect(isPublicAddress("0.0.0.0")).toBe(false);
    expect(isPublicAddress("::")).toBe(false);
  });

  it("refuses anything that is not an address at all", () => {
    expect(isPublicAddress("localhost")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
    expect(isPublicAddress("999.999.999.999")).toBe(false);
  });

  it("refuses an address written in decimal, which some parsers accept", () => {
    // 2130706433 is 127.0.0.1 written as a single integer. Some resolvers and
    // HTTP clients accept it; this must not be one of them.
    expect(isPublicAddress("2130706433")).toBe(false);
  });
});

describe("describeAddress", () => {
  it("names the category an address falls into", () => {
    expect(describeAddress("127.0.0.1")).toBe("loopback");
    expect(describeAddress("10.0.0.1")).toBe("private");
  });

  it("says so when the input is not an address", () => {
    expect(describeAddress("nonsense")).toBe("not an IP address");
  });
});
