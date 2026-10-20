"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Check, Loader2, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { signupAction, type SignupField, type SignupState } from "@/lib/auth/actions";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { emailSchema } from "@/lib/validation/auth";
import { PASSWORD_RULES, passwordProblems, passwordScore } from "@/lib/validation/password";
import { AuthFooter, FloatingInput, ShowPasswordToggle } from "./auth-parts";
import { AddingNotice } from "./login-form";

const initialState: SignupState = { error: null, fields: [], values: { email: "" } };

/**
 * Public sign-up in the same Instagram-style card as the login screen, step 1 of 2: email and
 * password. Step 2 connects Instagram (/signup/instagram), which also names the business.
 * `adding`: "Add account" → "Create a new account" — the signed-in login stays remembered on this device.
 */
export function SignupForm({ adding = false }: { adding?: boolean }) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(signupAction, initialState);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<SignupField, boolean>>>({});

  const personal = { email, name: "" };
  const problems = passwordProblems(password, personal);
  const score = passwordScore(password, personal);
  const emailValid = emailSchema.safeParse(email).success;
  const valid = emailValid && problems.length === 0;
  const serverInvalid = (field: SignupField) => state.fields.includes(field);
  const invalid = (field: SignupField, ok: boolean) => (touched[field] && !ok) || serverInvalid(field);
  const touch = (field: SignupField) => () => setTouched((v) => ({ ...v, [field]: true }));

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12">
        <div className="w-full max-w-[350px]">
          <div className="border-border px-4 pt-8 pb-6 sm:rounded-[1px] sm:border sm:px-10 sm:pt-10">
            <div className="mb-3 flex justify-center">
              <Logo className="[&_svg]:size-9 [&>span]:text-[30px]" />
            </div>
            <p className="mb-2 text-center text-[17px] leading-5 font-semibold text-muted">{t("signup.tagline")}</p>
            <p className="mb-6 text-center text-caption text-muted" data-testid="signup-step">
              {t("signup.stepOf", { n: 1, total: 2 })} · {t("signup.steps.account")}
            </p>

            {adding && <AddingNotice hint={t("deviceAccounts.addingSignupHint")} />}

            <form action={formAction} className="space-y-1.5" noValidate>
              <FloatingInput
                name="email"
                type="email"
                autoComplete="email"
                label={t("auth.email")}
                value={email}
                onChange={setEmail}
                onBlur={touch("email")}
                invalid={invalid("email", emailValid)}
              />
              <FloatingInput
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                label={t("auth.password")}
                value={password}
                onChange={setPassword}
                onBlur={touch("password")}
                invalid={invalid("password", problems.length === 0)}
                aria-describedby="password-rules"
                trailing={password && <ShowPasswordToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
              />
              {password && <StrengthMeter score={score} />}
              <ul id="password-rules" className="space-y-0.5 px-0.5 pt-1 pb-1" aria-live="polite">
                {PASSWORD_RULES.map((rule) => {
                  const met = password.length > 0 && !problems.includes(rule);
                  return (
                    <li key={rule} className={cn("flex items-center gap-1.5 text-caption", met ? "text-success" : "text-muted")}>
                      {met ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : <X className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />}
                      {t(`signup.rules.${rule}`)}
                      <span className="sr-only">{met ? t("signup.ruleMet") : t("signup.ruleNotMet")}</span>
                    </li>
                  );
                })}
              </ul>

              <p className="px-1 pt-3 pb-1 text-center text-caption text-muted">{t("signup.terms")}</p>
              <Button type="submit" className="w-full" disabled={!valid || pending} aria-busy={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-label={t("signup.creating")} /> : t("signup.submit")}
              </Button>
            </form>

            {state.error && (
              <p role="alert" className="mt-5 text-center text-body text-danger">
                {state.error === "email_taken" ? (
                  <>
                    {t("signup.errors.email_taken")}{" "}
                    <Link href="/forgot-password" className="font-semibold text-link hover:underline">
                      {t("auth.forgot")}
                    </Link>
                  </>
                ) : (
                  t(`signup.errors.${state.error}`)
                )}
              </p>
            )}
          </div>

          <div className="mt-2.5 border-border py-5 text-center text-body sm:rounded-[1px] sm:border">
            {t("signup.haveAccount")}{" "}
            <Link href={adding ? "/login?add=1" : "/login"} className="font-semibold text-primary hover:text-link">
              {t("auth.login")}
            </Link>
          </div>
        </div>
      </main>
      <AuthFooter />
    </div>
  );
}

const LEVELS = ["", "weak", "fair", "good", "strong"] as const;

function StrengthMeter({ score }: { score: number }) {
  const { t } = useI18n();
  const color = score <= 1 ? "bg-danger" : score === 2 ? "bg-warning" : "bg-success";
  return (
    <div className="flex items-center gap-2 px-0.5 pt-1" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-pill", i <= score ? color : "bg-border")} />
        ))}
      </div>
      <span className="text-caption text-muted">{score > 0 && t(`signup.strength.${LEVELS[score]}`)}</span>
    </div>
  );
}
