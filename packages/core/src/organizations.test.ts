import { describe, expect, it } from "vitest";
import {
  canDeleteOrganization,
  marksPersonalOrganization,
  organizationLandingSpaceId,
  organizationOfSpace,
} from "./organizations.js";

const work = {
  id: "org-work",
  name: "Work",
  defaultSpaceId: "a1",
  spaceIds: ["a1", "a2"],
  canManage: true,
  personal: false,
};
const home = {
  id: "org-home",
  name: "Home",
  defaultSpaceId: "b1",
  spaceIds: ["b1", "b2"],
  canManage: true,
  personal: true,
};

describe("organizationLandingSpaceId", () => {
  it("opens the Space last used there, else the default", () => {
    expect(organizationLandingSpaceId(home, { "org-home": "b2" })).toBe("b2");
    expect(organizationLandingSpaceId(home, { "org-home": "deleted" })).toBe("b1");
    expect(organizationLandingSpaceId(home, { "org-work": "a2" })).toBe("b1");
  });
});

describe("organizationOfSpace", () => {
  it("finds the organization holding the Space", () => {
    expect(organizationOfSpace([work, home], "b2")).toBe(home);
    expect(organizationOfSpace([work, home], "elsewhere")).toBeUndefined();
    expect(organizationOfSpace([work, home], null)).toBeUndefined();
  });
});

describe("canDeleteOrganization", () => {
  it("lets an owner delete one while they own another", () => {
    const shared = { ...home, id: "org-shared", canManage: false };
    expect(canDeleteOrganization([work, home], home)).toBe(true);
    expect(canDeleteOrganization([work, shared], work)).toBe(false);
    expect(canDeleteOrganization([work, home, shared], shared)).toBe(false);
  });
});

describe("marksPersonalOrganization", () => {
  it("marks the account's own organization once its name no longer says so", () => {
    const personal = { ...home, name: "Personal" };
    expect(marksPersonalOrganization([work, personal], personal)).toBe(false);
    expect(marksPersonalOrganization([work, home], home)).toBe(true);
    expect(marksPersonalOrganization([work, home], work)).toBe(false);
    const twin = { ...work, name: "Personal" };
    expect(marksPersonalOrganization([twin, personal], personal)).toBe(true);
    expect(marksPersonalOrganization([twin, personal], twin)).toBe(false);
  });
});
