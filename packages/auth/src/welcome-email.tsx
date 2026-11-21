/** @jsxRuntime automatic */
import type { TransactionalEmail } from "@robots/adapter-kit";
import { listedMobileApps } from "@robots/contracts";
import { Link, Text } from "react-email";
import { emailText, greeting, linkStyle, message, withNodes } from "./email.js";

const MOBILE_APP_NAMES = { ios: "iPhone", android: "Android" } as const;

const APPS: Readonly<Record<string, string>> = Object.fromEntries([
  ...listedMobileApps().map(({ platform, href }) => [MOBILE_APP_NAMES[platform], href]),
  ["Mac", "https://tryrobots.app/api/download?platform=mac"],
  ["Windows", "https://tryrobots.app/api/download?platform=windows"],
  ["Linux", "https://tryrobots.app/api/download?platform=linux"],
]);

const stepStyle = { margin: "20px 0 4px" };

export function welcomeEmail(
  user: { email: string; name: string },
  unsubscribeUrl: string,
  locale = "en",
): Promise<TransactionalEmail> {
  const say = emailText(locale);
  return message(
    user.email,
    locale,
    say("Welcome to RoBots"),
    <>
      <Text>{greeting(say, user.name)}</Text>
      <Text>
        {say("Welcome to RoBots. The people who get the most out of it do three things:")}
      </Text>
      <Text style={stepStyle}>
        <strong>1. {say("Get the apps")}</strong>
      </Text>
      <Text style={{ marginTop: 0 }}>
        {withNodes(
          say("RoBots runs on {platforms}, so your bots can reach you wherever you are."),
          {
            platforms: new Intl.ListFormat(locale, { type: "conjunction" })
              .formatToParts(Object.keys(APPS))
              .map((part, index) =>
                part.type === "element" ? (
                  <Link key={part.value} href={APPS[part.value]} style={linkStyle}>
                    {part.value}
                  </Link>
                ) : (
                  <span key={`${index}${part.value}`}>{part.value}</span>
                ),
              ),
          },
        )}
      </Text>
      <Text style={stepStyle}>
        <strong>2. {say("Star us on GitHub")}</strong>
      </Text>
      <Text style={{ marginTop: 0 }}>
        {withNodes(say("RoBots is open source. {star} helps more people find it."), {
          star: (
            <Link href="https://github.com/AnalystTom/robots-app" style={linkStyle}>
              {say("A star on GitHub")}
            </Link>
          ),
        })}
      </Text>
      <Text style={{ marginTop: "28px" }}>{say("Questions? Just reply. We read every one.")}</Text>
      <Text>The RoBots team</Text>
    </>,
    unsubscribeUrl,
  );
}
