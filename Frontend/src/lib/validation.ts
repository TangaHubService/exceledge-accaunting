import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from "react";
import * as yup from "yup";

export { yup };

export type FieldErrors<T extends string = string> = Partial<Record<T, string>>;

/** Collect Yup ValidationError into a flat path → message map. */
export function yupErrors(err: unknown): FieldErrors {
  if (!(err instanceof yup.ValidationError)) return {};
  const next: FieldErrors = {};
  const list = err.inner.length ? err.inner : [err];
  for (const item of list) {
    if (item.path && !next[item.path]) next[item.path] = item.message;
  }
  return next;
}

export async function validateYup(
  schema: yup.AnyObjectSchema,
  values: unknown,
): Promise<{ ok: true; values: unknown } | { ok: false; errors: FieldErrors }> {
  try {
    const parsed = await schema.validate(values, { abortEarly: false, stripUnknown: true });
    return { ok: true, values: parsed };
  } catch (err) {
    return { ok: false, errors: yupErrors(err) };
  }
}

/**
 * Lightweight Yup form helper: tracks touched/submitted and exposes inline field errors.
 * Works with controlled state you already own (pass `values` + `setValues` or use `setField`).
 */
export function useYupForm<T extends Record<string, unknown>>(
  schema: yup.AnyObjectSchema,
  values: T,
  setValues: Dispatch<SetStateAction<T>>,
) {
  const [errors, setErrors] = useState<FieldErrors<keyof T & string>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T & string, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  const showError = useCallback(
    (key: keyof T & string) => (submitted || touched[key] ? errors[key] : undefined),
    [errors, submitted, touched],
  );

  const setField = useCallback(
    <K extends keyof T & string>(key: K, value: T[K]) => {
      setValues((prev) => {
        const next = { ...prev, [key]: value };
        if (submitted || touched[key]) {
          void schema
            .validateAt(key, next)
            .then(() => setErrors((e) => ({ ...e, [key]: undefined })))
            .catch((err: unknown) => {
              if (err instanceof yup.ValidationError) {
                setErrors((e) => ({ ...e, [key]: err.message }));
              }
            });
        }
        return next;
      });
    },
    [schema, setValues, submitted, touched],
  );

  const blurField = useCallback(
    (key: keyof T & string) => {
      setTouched((t) => ({ ...t, [key]: true }));
      void schema
        .validateAt(key, values)
        .then(() => setErrors((e) => ({ ...e, [key]: undefined })))
        .catch((err: unknown) => {
          if (err instanceof yup.ValidationError) {
            setErrors((e) => ({ ...e, [key]: err.message }));
          }
        });
    },
    [schema, values],
  );

  const validate = useCallback(async () => {
    setSubmitted(true);
    const result = await validateYup(schema, values);
    if (result.ok) {
      setErrors({});
      return true;
    }
    setErrors(result.errors as FieldErrors<keyof T & string>);
    return false;
  }, [schema, values]);

  const resetValidation = useCallback(() => {
    setErrors({});
    setTouched({});
    setSubmitted(false);
  }, []);

  return useMemo(
    () => ({ errors, showError, setField, blurField, validate, resetValidation, setErrors, submitted }),
    [errors, showError, setField, blurField, validate, resetValidation, submitted],
  );
}

/* ── Shared field helpers ─────────────────────────────────────────── */

export const optionalEmail = yup
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .email("Enter a valid email address")
  .optional();

export const optionalUrl = yup
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .url("Enter a valid URL (include https://)")
  .optional();

/* ── Schemas ──────────────────────────────────────────────────────── */

export const signInSchema = yup.object({
  email: yup.string().trim().required("Enter your email address").email("Enter a valid email address"),
  password: yup.string().required("Enter your password"),
  remember: yup.boolean().default(true),
});

export type NewAccountValues = {
  name: string;
  code: string;
  accountTypeLabel: string;
  detailType: string;
  isSubaccount: boolean;
  parentId: string;
  description: string;
  locked: boolean;
};

export function newAccountSchema(opts: {
  existingCodes: Set<string>;
  range?: { min: number; max: number };
}) {
  return yup.object({
    name: yup.string().trim().required("Account name is required").max(120, "Keep the name under 120 characters"),
    code: yup
      .string()
      .trim()
      .required("Account number is required")
      .matches(/^\d{1,6}$/, "Use a numeric account number (up to 6 digits)")
      .test("unique", "This account number already exists", (v) => !v || !opts.existingCodes.has(v))
      .test("range", function (v) {
        if (!v || !opts.range) return true;
        const n = Number(v);
        if (!Number.isFinite(n) || n < opts.range.min || n > opts.range.max) {
          return this.createError({ message: `Use codes ${opts.range.min}–${opts.range.max}` });
        }
        return true;
      }),
    accountTypeLabel: yup.string().trim().required("Select an account type"),
    detailType: yup.string().trim().required("Select a detail type"),
    isSubaccount: yup.boolean().default(false),
    parentId: yup.string().when("isSubaccount", {
      is: true,
      then: (s) => s.required("Select a parent account"),
      otherwise: (s) => s.strip(),
    }),
    description: yup.string().trim().max(500, "Keep the description under 500 characters").default(""),
    locked: yup.boolean().default(false),
  });
}

export const customerSchema = yup.object({
  displayName: yup
    .string()
    .trim()
    .test("name", "Customer display name is required", function (v) {
      const { firstName, lastName, companyName } = this.parent as {
        firstName?: string;
        lastName?: string;
        companyName?: string;
      };
      const fallback = [firstName, lastName].filter(Boolean).join(" ").trim() || (companyName ?? "").trim();
      return Boolean((v ?? "").trim() || fallback);
    }),
  email: optionalEmail,
  website: optionalUrl,
  firstName: yup.string().trim().default(""),
  lastName: yup.string().trim().default(""),
  companyName: yup.string().trim().default(""),
  phone: yup.string().trim().default(""),
  mobile: yup.string().trim().default(""),
});

export const supplierSchema = yup.object({
  displayName: yup
    .string()
    .trim()
    .test("name", "Supplier display name is required", function (v) {
      const { firstName, lastName, companyName } = this.parent as {
        firstName?: string;
        lastName?: string;
        companyName?: string;
      };
      const fallback =
        [firstName, lastName].filter(Boolean).join(" ").trim() || (companyName ?? "").trim();
      return Boolean((v ?? "").trim() || fallback);
    }),
  email: optionalEmail,
  website: optionalUrl,
  firstName: yup.string().trim().default(""),
  lastName: yup.string().trim().default(""),
  companyName: yup.string().trim().default(""),
  phone: yup.string().trim().default(""),
  mobile: yup.string().trim().default(""),
});

export const employeePersonalSchema = yup.object({
  firstName: yup.string().trim().required("First name is required"),
  lastName: yup.string().trim().required("Last name is required"),
  email: optionalEmail,
  phone: yup.string().trim().default(""),
});

export const employeeEmploymentSchema = yup.object({
  joiningDate: yup.string().trim().required("Joining date is required"),
  jobTitle: yup.string().trim().default(""),
  department: yup.string().trim().default(""),
});
