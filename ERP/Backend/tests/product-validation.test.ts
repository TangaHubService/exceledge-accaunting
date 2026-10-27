import { describe, expect, it } from "vitest";
import { createProductSchema } from "../src/validations/products.validation";

const requiredRra = {
  taxCode: "B" as const,
  pkgUnitCd: "CT",
  itemClsCd: "5059690800",
};

describe("product validation schemas", () => {
  it("applies defaults and accepts the minimal required payload", () => {
    const result = createProductSchema.parse({
      body: {
        name: "widget",
        quantity: 5,
        unitPrice: 12.5,
        ...requiredRra,
      },
      params: {
        organizationId: 2,
      },
    });

    expect(result.body.taxCategory).toBe("STANDARD");
    expect(result.body.minStock).toBe(10);
    expect(result.body.name).toBe("widget");
    expect(result.body.quantity).toBe(5);
    expect(result.body.pkgUnitCd).toBe("CT");
    expect(result.body.taxCode).toBe("B");
  });

  it("rejects a payload that tries to set a negative quantity", () => {
    expect(() =>
      createProductSchema.parse({
        body: {
          name: "invalid",
          quantity: -1,
          unitPrice: 10,
          ...requiredRra,
        },
        params: {
          organizationId: 2,
        },
      })
    ).toThrow();
  });

  it("rejects PRODUCT without itemClsCd", () => {
    expect(() =>
      createProductSchema.parse({
        body: {
          name: "widget",
          quantity: 5,
          unitPrice: 12.5,
          taxCode: "B",
          pkgUnitCd: "CT",
        },
        params: {
          organizationId: 2,
        },
      })
    ).toThrow(/itemClsCd|RRA item classification/i);
  });

  it("rejects RAW_MATERIAL without itemClsCd", () => {
    expect(() =>
      createProductSchema.parse({
        body: {
          name: "raw material",
          quantity: 5,
          unitPrice: 12.5,
          itemType: "RAW_MATERIAL",
          taxCode: "B",
          pkgUnitCd: "CT",
        },
        params: {
          organizationId: 2,
        },
      })
    ).toThrow(/itemClsCd|RRA item classification/i);
  });

  it("rejects SERVICE without itemClsCd", () => {
    expect(() =>
      createProductSchema.parse({
        body: {
          name: "consultation",
          unitPrice: 100,
          itemType: "SERVICE",
          taxCode: "B",
          pkgUnitCd: "CT",
        },
        params: {
          organizationId: 2,
        },
      })
    ).toThrow(/itemClsCd|RRA item classification/i);
  });

  it("rejects create without packaging unit", () => {
    expect(() =>
      createProductSchema.parse({
        body: {
          name: "widget",
          unitPrice: 12.5,
          taxCode: "B",
          itemClsCd: "5059690800",
        },
        params: {
          organizationId: 2,
        },
      })
    ).toThrow(/pkgUnitCd|Packaging unit/i);
  });

  it("rejects create without tax code", () => {
    expect(() =>
      createProductSchema.parse({
        body: {
          name: "widget",
          unitPrice: 12.5,
          pkgUnitCd: "CT",
          itemClsCd: "5059690800",
        },
        params: {
          organizationId: 2,
        },
      })
    ).toThrow(/Tax code|taxCode|A, B, C/i);
  });

  it("accepts SERVICE with required RRA fields", () => {
    const result = createProductSchema.parse({
      body: {
        name: "consultation",
        unitPrice: 100,
        itemType: "SERVICE",
        ...requiredRra,
      },
      params: {
        organizationId: 2,
      },
    });
    expect(result.body.itemType).toBe("SERVICE");
    expect(result.body.itemClsCd).toBe("5059690800");
  });

  it("accepts a finished product with a raw-material recipe", () => {
    const result = createProductSchema.parse({
      body: {
        name: "finished widget",
        unitPrice: 100,
        ...requiredRra,
        bomComponents: [{ componentProductId: 11, quantity: 0.125, unit: "KG" }],
      },
      params: { organizationId: 2 },
    });

    expect(result.body.bomComponents).toEqual([{ componentProductId: 11, quantity: 0.125, unit: "KG" }]);
  });

  it("rejects a recipe on a raw material and duplicate components", () => {
    const base = {
      name: "item",
      unitPrice: 100,
      ...requiredRra,
    };
    const component = { componentProductId: 11, quantity: 0.125, unit: "KG" };

    expect(() => createProductSchema.parse({
      body: { ...base, itemType: "RAW_MATERIAL", bomComponents: [component] },
      params: { organizationId: 2 },
    })).toThrow("Bill of Materials can only be added to finished products");

    expect(() => createProductSchema.parse({
      body: { ...base, bomComponents: [component, component] },
      params: { organizationId: 2 },
    })).toThrow("Each raw material can be used only once");
  });
});
