import React, { useState } from "react";

import Nav from "./Nav";
import ShareMenu from "./ShareMenu";
import Content from "./Content";
import Sidebar from "./Sidebar";

import styles from "../../styles/player/_Player.module.scss";

// The whole editor on one page: nav, the video with its toolbar and
// timeline, and a sidebar for the tool that is open.
const Player = () => {
  // Where the Share menu draws its status alerts (above the video).
  const [alertsNode, setAlertsNode] = useState(null);

  return (
    <div className={styles.layout}>
      <Nav>
        <ShareMenu alertsNode={alertsNode} />
      </Nav>
      <div className={styles.body}>
        <Content alertsRef={setAlertsNode} />
        <Sidebar />
      </div>
    </div>
  );
};

export default Player;
