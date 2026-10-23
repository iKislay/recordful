import React, { useContext } from "react";

import { ContentStateContext } from "../../context/ContentState";
import { latestTakeName, webEditorUrl } from "../../../utils/webEditorUrl";

// Beside Share: moves this recording to Recordful's web editor, in a new tab.
// The site fetches the take from this extension inside the browser, so a
// self-hosted build can switch editors without uploading anything.
const OpenWebEditor = () => {
  const [contentState] = useContext(ContentStateContext);

  const open = async () => {
    const take = contentState.loadedTakeName || (await latestTakeName());
    window.open(webEditorUrl(take), "_blank", "noopener");
  };

  return (
    <button className="button secondaryButton" onClick={open}>
      {chrome.i18n.getMessage("openWebEditorLabel")}
    </button>
  );
};

export default OpenWebEditor;
