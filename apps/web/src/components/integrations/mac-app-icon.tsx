import type { LucideIcon } from "lucide-react";
import {
  Calendar,
  Contact,
  ListChecks,
  Mail,
  MapPin,
  MessageCircle,
  Monitor,
  Notebook,
} from "lucide-react";

const MAC_APP_ICONS: Record<string, LucideIcon> = {
  calendar: Calendar,
  contact: Contact,
  "list-checks": ListChecks,
  mail: Mail,
  "map-pin": MapPin,
  "message-circle": MessageCircle,
  notebook: Notebook,
};

export function MacAppIcon({ name }: { name: string }) {
  const Icon = MAC_APP_ICONS[name] ?? Monitor;
  return <Icon aria-hidden />;
}
