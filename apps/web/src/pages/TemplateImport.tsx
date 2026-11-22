import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@robots/ui-web";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { PageLoading } from "../components/PageLoading";
import { importBotTemplate, TEMPLATE_GALLERY_PATH } from "../lib/import-bot-template";
import { useQueryUserId } from "../lib/query";
import { errorText } from "../lib/user-error";
import { AuthFrame, submitClass } from "./Auth";

export function TemplateImportPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { templateId = "" } = useParams();
  const userId = useQueryUserId();
  const imported = useQuery({
    queryKey: ["template-import", userId, templateId],
    queryFn: async () => {
      const botId = await importBotTemplate(templateId);
      return botId ? `/app/${botId}` : TEMPLATE_GALLERY_PATH;
    },
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });

  if (imported.data) return <Navigate to={imported.data} replace />;
  if (!imported.error) return <PageLoading />;
  return (
    <AuthFrame
      title={errorText(imported.error, t`Could not add this bot`)}
      onSubmit={(event) => {
        event.preventDefault();
        navigate(TEMPLATE_GALLERY_PATH, { replace: true });
      }}
    >
      <Button type="submit" className={submitClass}>
        <Trans>Browse templates</Trans>
      </Button>
    </AuthFrame>
  );
}
