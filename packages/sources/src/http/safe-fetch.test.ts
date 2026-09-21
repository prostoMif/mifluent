import { isAppError } from "@mifluent/core";
import { describe, expect, it } from "vitest";
import { resolvePublicHost } from "./resolve-host.js";
import { answerLookup, safeFetch } from "./safe-fetch.js";

const USER_AGENT = "Mifluent/test";

/**
 * None of these reach the network.
 *
 * That is the point: every address below is refused before a socket is opened,
 * so the test proves the refusal rather than proving that the machine running
 * the tests happens to have nothing listening on that port.
 */
async function expectRefused(url: string): Promise<string> {
  try {
    await safeFetch({ url, userAgent: USER_AGENT });
  } catch (error) {
    if (isAppError(error)) {
      return error.code;
    }
    return "not an AppError";
  }

  return "no error";
}

describe("safeFetch protocol rules", () => {
  it("refuses a file address", async () => {
    // The one that reads the server's own disk.
    expect(await expectRefused("file:///etc/passwd")).toBe("url_not_allowed");
  });

  it("refuses gopher, ftp and data addresses", async () => {
    expect(await expectRefused("gopher://example.com/")).toBe("url_not_allowed");
    expect(await expectRefused("ftp://example.com/")).toBe("url_not_allowed");
    expect(await expectRefused("data:text/plain,hello")).toBe("url_not_allowed");
  });

  it("refuses something that is not a URL at all", async () => {
    expect(await expectRefused("not a url")).toBe("url_not_allowed");
  });
});

describe("safeFetch address rules", () => {
  it("refuses loopback given as a literal", async () => {
    expect(await expectRefused("http://127.0.0.1/")).toBe("url_not_allowed");
  });

  it("refuses IPv6 loopback written in brackets", async () => {
    // URL.hostname keeps the brackets, so this is the form the check actually
    // receives. It was wrong once.
    expect(await expectRefused("http://[::1]/")).toBe("url_not_allowed");
  });

  it("refuses the cloud metadata address", async () => {
    expect(await expectRefused("http://169.254.169.254/latest/meta-data/")).toBe("url_not_allowed");
  });

  it("refuses a private address on a non-standard port", async () => {
    // The port is not what makes it dangerous, and a rule written about ports
    // would miss this.
    expect(await expectRefused("http://192.168.1.1:8080/admin")).toBe("url_not_allowed");
  });

  it("refuses a private address carrying credentials", async () => {
    expect(await expectRefused("http://user:secret@10.0.0.1/")).toBe("url_not_allowed");
  });

  it("refuses loopback written as a single decimal number", async () => {
    // 2130706433 is 127.0.0.1. Some HTTP clients accept the form; this one
    // must refuse it, and it does because the string is not a valid address
    // and does not resolve either.
    const code = await expectRefused("http://2130706433/");
    expect(code === "url_not_allowed" || code === "source_unreachable").toBe(true);
  });
});

describe("resolvePublicHost", () => {
  it("accepts a public address given as a literal", async () => {
    await expect(resolvePublicHost("93.184.216.34")).resolves.toEqual({
      address: "93.184.216.34",
      family: 4,
    });
  });

  it("refuses a private address given as a literal", async () => {
    await expect(resolvePublicHost("10.1.2.3")).rejects.toThrow();
  });

  it("strips the brackets around an IPv6 literal before checking it", async () => {
    await expect(resolvePublicHost("[::1]")).rejects.toThrow();
  });
});

describe("answerLookup", () => {
  const host = { address: "93.184.216.34", family: 4 };

  it("answers with an array when the socket layer asks for every address", () => {
    // Node does this by default since version 20, to try IPv6 and IPv4 at the
    // same time. Answering with a bare string here made every outbound request
    // fail with "could not be reached" and no hint as to why.
    let received: unknown;
    answerLookup(host, true, ((_error: unknown, value: unknown) => {
      received = value;
    }) as never);

    expect(received).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("answers with a single address when asked for one", () => {
    const received: unknown[] = [];
    answerLookup(host, false, ((_error: unknown, address: unknown, family: unknown) => {
      received.push(address, family);
    }) as never);

    expect(received).toEqual(["93.184.216.34", 4]);
  });
});
