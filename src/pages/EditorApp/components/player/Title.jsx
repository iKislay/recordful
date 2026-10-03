import React, { useContext, useState, useEffect, useRef } from "react";

// Styles
import styles from "../../styles/player/_Title.module.scss";

// Icon
import { PencilSimple } from "@phosphor-icons/react";

// Context
import { ContentStateContext } from "../../context/ContentState"; // Import the ContentState context

const Title = () => {
  const [contentState, setContentState] = useContext(ContentStateContext); // Access the ContentState context
  const inputRef = useRef(null);
  // Show the video title, as a heading by default (multiline), on click show a text input to edit the title
  const [showTitle, setShowTitle] = useState(true);
  const [title, setTitle] = useState(contentState.title);
  const [displayTitle, setDisplayTitle] = useState(contentState.title);

  useEffect(() => {
    setTitle(contentState.title);
    if (contentState.title.length > 80) {
      setDisplayTitle(contentState.title.slice(0, 80) + "...");
    } else {
      setDisplayTitle(contentState.title);
    }
  }, [contentState.title]);

  const handleTitleChange = (e) => {
    setTitle(e.target.value);
  };

  const handleTitleClick = () => {
    setShowTitle(false);
  };

  const handleTitleBlur = () => {
    setShowTitle(true);
    setContentState((prevState) => ({
      ...prevState,
      title: title,
    }));
  };

  useEffect(() => {
    if (!showTitle) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [showTitle]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Enter") {
        setShowTitle(true);
        setContentState((prevState) => ({
          ...prevState,
          title: title,
        }));
      } else if (e.key === "Escape") {
        setShowTitle(true);
        setTitle(contentState.title);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [title]);

  return (
    <div className={styles.TitleParent}>
      <div className={styles.TitleWrap}>
        {showTitle ? (
          <>
            <h1 onClick={handleTitleClick}>
              {displayTitle}{" "}
              <PencilSimple
                size={16}
                className={styles.pencil}
                style={{ display: "inline-block" }}
              />
            </h1>
          </>
        ) : (
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            onBlur={handleTitleBlur}
            ref={inputRef}
          />
        )}
      </div>
    </div>
  );
};

export default Title;
