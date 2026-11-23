import type { MacAppToolName } from "@robots/contracts";

export type ScriptedMacTool = Exclude<MacAppToolName, "mac_messages_chats" | "mac_messages_read">;

export const MAC_APP_BUNDLES = {
  mail: "com.apple.mail",
  messages: "com.apple.MobileSMS",
  notes: "com.apple.Notes",
  reminders: "com.apple.reminders",
  calendar: "com.apple.iCal",
  contacts: "com.apple.AddressBook",
} as const;

const HELPERS = `
const clip = (value, max) => {
  const text = value == null ? "" : String(value);
  return text.length > max ? text.slice(0, max) + "…" : text;
};
const iso = (value) => (value ? new Date(value).toISOString() : null);
const fail = (code) => {
  throw new Error("ROBOTS:" + code);
};
const html = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const paragraphs = (value) =>
  String(value)
    .split("\\n")
    .map((line) => "<div>" + (line ? html(line) : "<br>") + "</div>")
    .join("");
`;

function script(appBundle: string | null, body: string) {
  const app = appBundle ? `const App = Application(${JSON.stringify(appBundle)});\n` : "";
  return `${HELPERS}${app}function run(argv) {\n  const input = JSON.parse(argv[0]);\n${body}\n}\n`;
}

const MAILBOX = `
  const mailbox = {
    inbox: () => App.inbox,
    sent: () => App.sentMailbox,
    drafts: () => App.draftsMailbox,
    junk: () => App.junkMailbox,
    trash: () => App.trashMailbox,
  }[input.mailbox]();
`;

const COMPOSE = `
  const message = App.OutgoingMessage({ subject: input.subject, content: input.body, visible: true });
  App.outgoingMessages.push(message);
  for (const address of input.to) message.toRecipients.push(App.ToRecipient({ address }));
  for (const address of input.cc) message.ccRecipients.push(App.CcRecipient({ address }));
  for (const address of input.bcc) message.bccRecipients.push(App.BccRecipient({ address }));
`;

const LOCATION = `
ObjC.import("CoreLocation");
ObjC.import("Foundation");
function run(argv) {
  const input = JSON.parse(argv[0]);
  if (!$.CLLocationManager.locationServicesEnabled) throw new Error("ROBOTS:location-off");
  const manager = $.CLLocationManager.alloc.init;
  manager.desiredAccuracy = 100;
  if (manager.requestWhenInUseAuthorization) manager.requestWhenInUseAuthorization;
  manager.startUpdatingLocation;
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.25));
    const status = $.CLLocationManager.authorizationStatus;
    if (status === 1 || status === 2) throw new Error("ROBOTS:location-denied");
    const location = manager.location;
    if (location && !location.isNil() && location.horizontalAccuracy >= 0) {
      manager.stopUpdatingLocation;
      return JSON.stringify({
        latitude: location.coordinate.latitude,
        longitude: location.coordinate.longitude,
        accuracy_m: Math.round(location.horizontalAccuracy),
        at: new Date(location.timestamp.timeIntervalSince1970 * 1000).toISOString(),
      });
    }
  }
  manager.stopUpdatingLocation;
  throw new Error("ROBOTS:location-timeout");
}
`;

export const LOCATION_STATUS_SCRIPT = `
ObjC.import("CoreLocation");
function run() {
  return JSON.stringify({
    enabled: Boolean($.CLLocationManager.locationServicesEnabled),
    status: Number($.CLLocationManager.authorizationStatus),
  });
}
`;

export const AUTOMATION_PROBE_SCRIPT = `
function run(argv) {
  const app = Application(argv[0]);
  app.launch();
  return JSON.stringify({ windows: app.windows.length });
}
`;

export const MAC_TOOL_SCRIPTS: Record<ScriptedMacTool, string> = {
  mac_mail_search: script(
    MAC_APP_BUNDLES.mail,
    `${MAILBOX}
  const filters = [];
  if (input.query)
    filters.push({ _or: [{ subject: { _contains: input.query } }, { sender: { _contains: input.query } }] });
  if (input.unread_only) filters.push({ readStatus: false });
  const messages = filters.length
    ? mailbox.messages.whose(filters.length === 1 ? filters[0] : { _and: filters })
    : mailbox.messages;
  const ids = messages.id();
  const subjects = messages.subject();
  const senders = messages.sender();
  const dates = messages.dateReceived();
  const read = messages.readStatus();
  const rows = ids.map((id, index) => ({
    id,
    subject: clip(subjects[index], 300),
    sender: clip(senders[index], 300),
    date: iso(dates[index]),
    read: Boolean(read[index]),
  }));
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return JSON.stringify({ mailbox: input.mailbox, messages: rows.slice(0, input.limit) });`,
  ),
  mac_mail_read: script(
    MAC_APP_BUNDLES.mail,
    `${MAILBOX}
  const found = mailbox.messages.whose({ id: input.id })();
  if (!found.length) fail("not-found");
  const message = found[0];
  return JSON.stringify({
    id: message.id(),
    subject: message.subject(),
    sender: message.sender(),
    to: message.toRecipients.address(),
    cc: message.ccRecipients.address(),
    date: iso(message.dateReceived()),
    body: clip(message.content(), input.max_chars),
  });`,
  ),
  mac_mail_draft: script(
    MAC_APP_BUNDLES.mail,
    `${COMPOSE}
  App.activate();
  return JSON.stringify({ drafted: true, subject: input.subject });`,
  ),
  mac_mail_send: script(
    MAC_APP_BUNDLES.mail,
    `  App.activate();
${COMPOSE}
  if (!message.send()) fail("not-sent");
  return JSON.stringify({ sent: true, to: input.to, subject: input.subject });`,
  ),
  mac_messages_send: script(
    MAC_APP_BUNDLES.messages,
    `  let target;
  if (input.chat_guid) {
    target = App.chats.byId(input.chat_guid);
    target.id();
  } else {
    const account =
      App.accounts.whose({ serviceType: "iMessage", enabled: true })()[0] ||
      App.accounts.whose({ enabled: true })()[0];
    if (!account) fail("no-account");
    target = account.participants.byName(input.to);
  }
  App.send(input.text, { to: target });
  return JSON.stringify({ sent: true });`,
  ),
  mac_notes_search: script(
    MAC_APP_BUNDLES.notes,
    `  const notes = App.notes.whose({
    _or: [{ name: { _contains: input.query } }, { plaintext: { _contains: input.query } }],
  });
  const ids = notes.id();
  const names = notes.name();
  const modified = notes.modificationDate();
  const rows = ids.map((id, index) => ({
    id,
    title: clip(names[index], 300),
    modified: iso(modified[index]),
  }));
  rows.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
  return JSON.stringify({ notes: rows.slice(0, input.limit) });`,
  ),
  mac_notes_read: script(
    MAC_APP_BUNDLES.notes,
    `  const note = App.notes.byId(input.id);
  return JSON.stringify({
    id: note.id(),
    title: note.name(),
    modified: iso(note.modificationDate()),
    text: clip(note.plaintext(), input.max_chars),
  });`,
  ),
  mac_notes_create: script(
    MAC_APP_BUNDLES.notes,
    `  const folder = input.folder
    ? App.folders.whose({ name: input.folder })()[0]
    : App.defaultAccount.defaultFolder;
  if (!folder) fail("not-found");
  const note = App.Note({ body: "<div><h1>" + html(input.title) + "</h1></div>" + paragraphs(input.body) });
  folder.notes.push(note);
  return JSON.stringify({ id: note.id(), title: note.name() });`,
  ),
  mac_notes_append: script(
    MAC_APP_BUNDLES.notes,
    `  const note = App.notes.byId(input.id);
  note.body = note.body() + paragraphs(input.text);
  return JSON.stringify({ id: note.id(), title: note.name() });`,
  ),
  mac_reminders_list: script(
    MAC_APP_BUNDLES.reminders,
    `  const lists = input.list ? App.lists.whose({ name: input.list })() : App.lists();
  if (input.list && !lists.length) fail("not-found");
  const items = [];
  for (const list of lists) {
    if (items.length >= input.limit) break;
    const reminders = input.include_completed ? list.reminders : list.reminders.whose({ completed: false });
    const ids = reminders.id();
    const names = reminders.name();
    const due = reminders.dueDate();
    const done = reminders.completed();
    const notes = reminders.body();
    const listName = list.name();
    ids.forEach((id, index) => {
      if (items.length < input.limit)
        items.push({
          id,
          title: clip(names[index], 300),
          list: listName,
          due: iso(due[index]),
          completed: Boolean(done[index]),
          notes: clip(notes[index], 1000),
        });
    });
  }
  return JSON.stringify({ lists: App.lists.name(), reminders: items });`,
  ),
  mac_reminders_create: script(
    MAC_APP_BUNDLES.reminders,
    `  const list = input.list ? App.lists.whose({ name: input.list })()[0] : App.defaultList();
  if (!list) fail("not-found");
  const properties = { name: input.title };
  if (input.due) properties.dueDate = new Date(input.due);
  if (input.notes) properties.body = input.notes;
  const reminder = App.Reminder(properties);
  list.reminders.push(reminder);
  return JSON.stringify({ id: reminder.id(), list: list.name() });`,
  ),
  mac_reminders_complete: script(
    MAC_APP_BUNDLES.reminders,
    `  const reminder = App.reminders.byId(input.id);
  reminder.completed = true;
  return JSON.stringify({ id: reminder.id(), title: reminder.name(), completed: true });`,
  ),
  mac_calendar_events: script(
    MAC_APP_BUNDLES.calendar,
    `  const from = new Date(input.from);
  const to = new Date(input.to);
  const calendars = input.calendar ? App.calendars.whose({ name: input.calendar })() : App.calendars();
  if (input.calendar && !calendars.length) fail("not-found");
  const rows = [];
  for (const calendar of calendars) {
    const events = calendar.events.whose({
      _and: [{ startDate: { _lessThan: to } }, { endDate: { _greaterThan: from } }],
    });
    const ids = events.uid();
    const titles = events.summary();
    const starts = events.startDate();
    const ends = events.endDate();
    const locations = events.location();
    const allDay = events.alldayEvent();
    const name = calendar.name();
    ids.forEach((id, index) =>
      rows.push({
        id,
        title: clip(titles[index], 300),
        start: iso(starts[index]),
        end: iso(ends[index]),
        all_day: Boolean(allDay[index]),
        location: clip(locations[index], 300),
        calendar: name,
      }),
    );
  }
  rows.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return JSON.stringify({ events: rows.slice(0, input.limit) });`,
  ),
  mac_calendar_create_event: script(
    MAC_APP_BUNDLES.calendar,
    `  const calendar = input.calendar
    ? App.calendars.whose({ name: input.calendar })()[0]
    : App.calendars.whose({ writable: true })()[0];
  if (!calendar) fail("not-found");
  const properties = {
    summary: input.title,
    startDate: new Date(input.start),
    endDate: new Date(input.end),
    alldayEvent: input.all_day,
  };
  if (input.location) properties.location = input.location;
  if (input.notes) properties.description = input.notes;
  const event = App.Event(properties);
  calendar.events.push(event);
  return JSON.stringify({ id: event.uid(), calendar: calendar.name() });`,
  ),
  mac_contacts_search: script(
    MAC_APP_BUNDLES.contacts,
    `  const people = App.people.whose({
    _or: [{ name: { _contains: input.query } }, { organization: { _contains: input.query } }],
  });
  const ids = people.id();
  const names = people.name();
  const companies = people.organization();
  const rows = ids.map((id, index) => ({
    id,
    name: clip(names[index], 300),
    company: clip(companies[index], 300),
  }));
  return JSON.stringify({ people: rows.slice(0, input.limit) });`,
  ),
  mac_contacts_read: script(
    MAC_APP_BUNDLES.contacts,
    `  const person = App.people.byId(input.id);
  const labeled = (items) => {
    const labels = items.label();
    return items.value().map((value, index) => ({ label: labels[index], value }));
  };
  return JSON.stringify({
    id: person.id(),
    name: person.name(),
    company: person.organization(),
    job_title: person.jobTitle(),
    emails: labeled(person.emails),
    phones: labeled(person.phones),
    addresses: person.addresses.formattedAddress(),
    birthday: iso(person.birthDate()),
    note: clip(person.note(), 5000),
  });`,
  ),
  mac_location_current: LOCATION,
};
