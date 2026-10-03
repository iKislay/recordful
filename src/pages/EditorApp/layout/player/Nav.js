import React from "react";
import styles from "../../styles/player/_Nav.module.scss";

// Compact top bar: the logo in the middle, the page's actions on the right.
const Nav = ({ children }) => (
  <div className={styles.nav}>
    <button
      className={styles.logo}
      aria-label="home"
      onClick={() => chrome.runtime.sendMessage({ type: "open-home" })}
    >
      <img src="/assets/editor/logo.svg" alt="Recordful" />
    </button>
    <div className={styles.navRight}>{children}</div>
  </div>
);

export default Nav;
