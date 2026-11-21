import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cleanLoginEmailHint, LOGIN_EMAIL_HINT_KEY } from "./login-email-hint";

test("only something shaped like an email is carried to the sign-in page", () => {
  expect(cleanLoginEmailHint(" Pat@Example.com ")).toBe("pat@example.com");
  expect(cleanLoginEmailHint("not an email")).toBe("");
  expect(cleanLoginEmailHint(null)).toBe("");
});

test("signup offers sign-in first and the email never goes in the address", () => {
  const signup = readFileSync(new URL("../routes/signup.tsx", import.meta.url), "utf8");
  expect(signup).toContain("Sign in with this email →");
  expect(signup).toContain("sessionStorage.setItem(LOGIN_EMAIL_HINT_KEY, email)");
  expect(signup).not.toMatch(/\/login\?email=/);
  const login = readFileSync(new URL("../routes/login.tsx", import.meta.url), "utf8");
  expect(login).toContain("sessionStorage.removeItem(LOGIN_EMAIL_HINT_KEY)");
  expect(LOGIN_EMAIL_HINT_KEY).toBe("contrax_login_email_hint");
});
