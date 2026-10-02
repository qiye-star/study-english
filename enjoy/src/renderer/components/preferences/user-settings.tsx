import { t } from "i18next";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  Button,
} from "@renderer/components/ui";
import { AppSettingsProviderContext } from "@renderer/context";
import { useContext } from "react";

export const UserSettings = () => {
  const { user, logout } = useContext(AppSettingsProviderContext);

  if (!user) return null;
  return (
    <>
      <div className="flex items-start justify-between py-4">
        <div className="">
          <div className="flex items-center space-x-2">
            <Avatar>
              <AvatarImage crossOrigin="anonymous" src={user.avatarUrl} />
              <AvatarFallback className="text-xl">
                {user.name[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="">
              <div className="text-sm font-semibold">{user.name}</div>
              <div className="text-xs text-muted-foreground">{user.id}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-2">
          <Button
            variant="secondary"
            className="text-destructive"
            size="sm"
            onClick={logout}
          >
            {t("logout")}
          </Button>
        </div>
      </div>
    </>
  );
};
