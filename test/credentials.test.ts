import { describe, it, expect } from "vitest";
import { planAuth } from "../src/aws/credentials";

describe("planAuth credential precedence", () => {
  it("prefers explicit CLI keys over saved config and env", () => {
    const plan = planAuth(
      { accessKeyId: "AKIA_CLI", secretAccessKey: "cli-secret", region: "us-west-2" },
      { profile: "saved", accessKeyId: "OLD", secretAccessKey: "OLD", region: "eu-west-1" },
      { AWS_REGION: "ap-south-1" },
    );
    expect(plan.mode).toBe("static");
    expect(plan.static).toEqual({
      accessKeyId: "AKIA_CLI",
      secretAccessKey: "cli-secret",
      sessionToken: undefined,
    });
    expect(plan.region).toBe("us-west-2");
  });

  it("uses a CLI profile when no inline keys are given", () => {
    const plan = planAuth({ profile: "work" }, { accessKeyId: "A", secretAccessKey: "B" }, {});
    expect(plan.mode).toBe("profile");
    expect(plan.profile).toBe("work");
  });

  it("falls back to saved static keys", () => {
    const plan = planAuth({}, { accessKeyId: "A", secretAccessKey: "B", region: "us-east-2" }, {});
    expect(plan.mode).toBe("static");
    expect(plan.region).toBe("us-east-2");
  });

  it("falls back to a saved profile", () => {
    const plan = planAuth({}, { profile: "saved" }, {});
    expect(plan.mode).toBe("profile");
    expect(plan.profile).toBe("saved");
  });

  it("falls back to the default provider chain", () => {
    const plan = planAuth({}, {}, {});
    expect(plan.mode).toBe("default");
  });
});

describe("planAuth region precedence", () => {
  it("CLI region wins over saved and env", () => {
    expect(
      planAuth({ region: "cli" }, { region: "saved" }, { AWS_REGION: "env" }).region,
    ).toBe("cli");
  });

  it("saved region wins over env", () => {
    expect(planAuth({}, { region: "saved" }, { AWS_REGION: "env" }).region).toBe("saved");
  });

  it("AWS_REGION wins over AWS_DEFAULT_REGION", () => {
    expect(planAuth({}, {}, { AWS_REGION: "r1", AWS_DEFAULT_REGION: "r2" }).region).toBe("r1");
  });

  it("uses AWS_DEFAULT_REGION as last resort", () => {
    expect(planAuth({}, {}, { AWS_DEFAULT_REGION: "r2" }).region).toBe("r2");
  });

  it("is undefined when nothing provides a region", () => {
    expect(planAuth({}, {}, {}).region).toBeUndefined();
  });
});
