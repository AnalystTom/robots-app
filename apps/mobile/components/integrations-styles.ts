import { StyleSheet } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { native } from "../lib/native";

export const LOGO_SIZE = 32;

export function createIntegrationsStyles() {
  const destructive = mobileTokens().destructive;
  return StyleSheet.create({
    connectionStatus: { flexDirection: "row", alignItems: "center", gap: 4 },
    screen: { flex: 1, backgroundColor: native.page },
    content: { padding: 20, gap: 14 },
    explanation: { color: native.secondaryLabel, fontSize: 14, lineHeight: 20 },
    section: { color: native.secondaryLabel, fontSize: 14, fontWeight: "600", marginTop: 2 },
    card: { padding: 16, borderRadius: 16, backgroundColor: native.fill, gap: 12 },
    input: {
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: native.fillPressed,
      color: native.label,
      paddingHorizontal: 14,
      fontSize: 15,
    },
    catalogGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    catalogStack: { gap: 8 },
    catalogCell: { flexGrow: 1, flexBasis: "47%", maxWidth: "49%" },
    row: {
      minHeight: 56,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 14,
      backgroundColor: native.fill,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    logoPlaceholder: {
      width: LOGO_SIZE,
      height: LOGO_SIZE,
      borderRadius: 10,
      backgroundColor: native.fillPressed,
    },
    titlePlaceholder: {
      width: "65%",
      height: 14,
      borderRadius: 4,
      backgroundColor: native.fillPressed,
    },
    pillPlaceholder: {
      width: 52,
      height: 30,
      borderRadius: 15,
      backgroundColor: native.fillPressed,
    },
    grow: { flex: 1, gap: 3, minWidth: 0 },
    title: { color: native.label, fontSize: 15, fontWeight: "600" },
    secondary: { color: native.secondaryLabel, fontSize: 13 },
    tertiary: { color: native.tertiaryLabel, fontSize: 13, marginLeft: 6 },
    pressed: { backgroundColor: native.fillPressed },
    categoryPicker: { alignSelf: "flex-start" },
    sectionHeader: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sectionTitle: { color: native.label, fontSize: 16, fontWeight: "600" },
    accountActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    link: { color: native.label, fontSize: 14, fontWeight: "600" },
    error: { color: destructive, fontSize: 14 },
    detail: { gap: 14 },
    backButton: { alignSelf: "flex-start", paddingVertical: 4 },
    hero: { flexDirection: "row", alignItems: "center", gap: 14 },
    heroTitle: { color: native.label, fontSize: 22, fontWeight: "600" },
    placement: { flexDirection: "row", alignItems: "center", gap: 6 },
    groupCard: { borderRadius: 16, backgroundColor: native.fill, overflow: "hidden" },
    groupRow: {
      minHeight: 52,
      paddingHorizontal: 16,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    groupDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: native.separator,
    },
    rowLabel: { color: native.label, fontSize: 15 },
    rowInput: { color: native.label, fontSize: 15, padding: 0, minHeight: 22 },
    caption: { color: native.secondaryLabel, fontSize: 13, paddingHorizontal: 16 },
    sheet: { flex: 1, gap: 14, paddingHorizontal: 20, backgroundColor: native.page },
    sheetHeader: { flexDirection: "row", justifyContent: "flex-end" },
    addCustom: { alignSelf: "flex-end", padding: 12 },
  });
}
