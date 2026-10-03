// Only the browser's own offline flag lets us blame the user's connection.
// Every other state names our end or stays neutral about whose end broke.
export const apiIssueCopy = (state) => {
  if (state === "offline") {
    return {
      title: chrome.i18n.getMessage("offlineLabelTitle"),
      description: chrome.i18n.getMessage("offlineLabelDescription"),
    };
  }
  if (state === "server") {
    return {
      title: chrome.i18n.getMessage("serverIssueTitle"),
      description: chrome.i18n.getMessage("serverIssueDescription"),
    };
  }
  if (state === "unreachable") {
    return {
      title: chrome.i18n.getMessage("serverUnreachableTitle"),
      description: chrome.i18n.getMessage("serverUnreachableDescription"),
    };
  }
  return null;
};
