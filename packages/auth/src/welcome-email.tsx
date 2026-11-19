/** @jsxRuntime automatic */
import type { TransactionalEmail } from "@robots/adapter-kit";
import { ANDROID_APP_STORE_URL, IOS_APP_STORE_URL, ROBOTS_DOWNLOADS_URL } from "@robots/contracts";
import { Link, Text } from "react-email";
import { emailText, greeting, linkStyle, message, withNodes } from "./email.js";

const APPS: Readonly<Record<string, string>> = {
  iPhone: IOS_APP_STORE_URL,
  Android: ANDROID_APP_STORE_URL,
  Mac: ROBOTS_DOWNLOADS_URL,
  Windows: ROBOTS_DOWNLOADS_URL,
  Linux: ROBOTS_DOWNLOADS_URL,
};

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
      <Text style={stepStyle}>
        <strong>{say("Get the apps")}</strong>
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
      <Text style={{ marginTop: "28px" }}>{say("Questions? Just reply.")}</Text>
      <Text>{say("The RoBots team")}</Text>
    </>,
    unsubscribeUrl,
    { src: "https://tryrobots.app/og.png", alt: "RoBots" },
  );
}
