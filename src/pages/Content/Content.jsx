import React, { useState, useContext, useEffect, useRef } from "react";

import Wrapper from "./Wrapper";

import ContentState from "./context/ContentState";

const Content = () => {
  return (
    <div className="recordful-shadow-dom">
      <ContentState>
        <Wrapper />
      </ContentState>
      <style type="text/css">{`
			/* Page-level theme tokens (outside the shadow tree: tooltips,
			   body-portaled menus and the driver.js onboarding popover read
			   these from <html>). html.recordful-dark is toggled by
			   ContentState whenever the popup theme changes. */
			html {
				--rf-bg: #fff;
				--rf-bg-hover: #f6f7fb;
				--rf-text: #29292f;
				--rf-text-secondary: #6e7684;
				--rf-text-contrast: #fff;
				--rf-strong: #111111;
				--rf-border: #e8e8e8;
				--rf-fixed-float-bg: #29292f;
				--rf-fixed-float-text: #fff;
				--color-background: #f9fafb;
				--color-text-primary: #1f2430;
				--color-text-secondary: #667085;
				--color-primary: #111111;
				--color-border: #d0d5dd;
			}
			html.recordful-dark {
				--rf-bg: #1e1e24;
				--rf-bg-hover: #2e2e37;
				--rf-text: #ececf1;
				--rf-text-secondary: #a3a3b2;
				--rf-text-contrast: #141416;
				--rf-strong: #f2f2f4;
				--rf-border: #38383f;
				--color-background: #1e1e24;
				--color-text-primary: #ececf1;
				--color-text-secondary: #a3a3b2;
				--color-primary: #f2f2f4;
				--color-border: #38383f;
			}
			#recordful-ui, #recordful-ui div {
				opacity: unset;
				background-color: unset;
				padding: unset;
				width: unset;
				box-shadow: unset;
				display: unset;
				margin: unset;
				border-radius: unset;
			}
			.recordful-outline {
				position: absolute;
				z-index: 99999999999;
				border: 2px solid var(--rf-strong);
				outline-offset: -2px;
				pointer-events: none;
				border-radius: 5px!important;
			}
		.recordful-blur {
			filter: blur(10px)!important;
		}
			.recordful-shadow-dom * {
				transition: unset;
			}
			.recordful-shadow-dom .TooltipContent {
  border-radius: 30px!important;
	background-color: var(--rf-fixed-float-bg)!important;
  padding: 10px 15px!important;
  font-size: 12px;
	margin-bottom: 10px!important;
	bottom: 100px;
  line-height: 1;
	font-family: 'Satoshi-Medium', sans-serif;
	z-index: 99999999!important;
  color: var(--rf-fixed-float-text);
  box-shadow: hsl(206 22% 7% / 35%) 0px 10px 38px -10px, hsl(206 22% 7% / 20%) 0px 10px 20px -15px!important;
  user-select: none;
	transition: opacity 0.3 ease-in-out;
  will-change: transform, opacity;
	animation-duration: 400ms;
  animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
}

.recordful-shadow-dom .hide-tooltip {
	display: none!important;
}

.recordful-shadow-dom .tooltip-tall {
	margin-bottom: 20px;
}

.recordful-shadow-dom .tooltip-small {
	margin-bottom: 5px;
}

.recordful-shadow-dom .TooltipContent[data-state='delayed-open'][data-side='top'] {
	animation-name: recordful-slideDownAndFade;
}
.recordful-shadow-dom .TooltipContent[data-state='delayed-open'][data-side='right'] {
  animation-name: recordful-slideLeftAndFade;
}
.recordful-shadow-dom.TooltipContent[data-state='delayed-open'][data-side='bottom'] {
  animation-name: recordful-slideUpAndFade;
}
.recordful-shadow-dom.TooltipContent[data-state='delayed-open'][data-side='left'] {
  animation-name: recordful-slideRightAndFade;
}

@keyframes recordful-slideUpAndFade {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes recordful-slideRightAndFade {
  from { opacity: 0; transform: translateX(-2px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes recordful-slideDownAndFade {
  from { opacity: 0; transform: translateY(-2px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes recordful-slideLeftAndFade {
  from { opacity: 0; transform: translateX(2px); }
  to   { opacity: 1; transform: translateX(0); }
}

#recordful-ui [data-radix-popper-content-wrapper] { z-index: 999999999999!important; }

.recordful-shadow-dom .CanvasContainer {
	position: fixed;
	pointer-events: all!important;
	top: 0px!important;
	left: 0px!important;
	z-index: 99999999999!important;
}
.recordful-shadow-dom .canvas {
	position: fixed;
	top: 0px!important;
	left: 0px!important;
	z-index: 99999999999!important;
	background: transparent!important;
}
.recordful-shadow-dom .canvas-container {
	top: 0px!important;
	left: 0px!important;
	z-index: 99999999999;
	position: fixed!important;
	background: transparent!important;
}

.RecordfulDropdownMenuContent {
	z-index: 99999999999!important;
  min-width: 200px;
  background-color: var(--rf-bg);
  margin-top: 4px;
  margin-right: 8px;
  padding-top: 12px;
  padding-bottom: 12px;
  border-radius: 15px;
  font-family: 'Satoshi-Medium', sans-serif;
  color: var(--rf-text);
  box-shadow: 0px 10px 38px -10px rgba(22, 23, 24, 0.35),
    0px 10px 20px -15px rgba(22, 23, 24, 0.2);
  animation-duration: 400ms;
  animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
}
.RecordfulDropdownMenuContent[data-side="top"] {
  animation-name: recordful-slideDownAndFade;
}
.RecordfulDropdownMenuContent[data-side="right"] {
  animation-name: recordful-slideLeftAndFade;
}
.RecordfulDropdownMenuContent[data-side="bottom"] {
  animation-name: recordful-slideUpAndFade;
}
.RecordfulDropdownMenuContent[data-side="left"] {
  animation-name: recordful-slideRightAndFade;
}
.RecordfulItemIndicator {
  position: absolute;
  right: 12px;
  width: 18px;
  height: 18px;
  background: var(--rf-strong);
  color: var(--rf-text-contrast);
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.RecordfulDropdownMenuItem,
.RecordfulDropdownMenuRadioItem {
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 5px;
  position: relative;
  padding-left: 22px;
  padding-right: 22px;
  user-select: none;
  outline: none;
}
.RecordfulDropdownMenuItem:hover {
    background-color: var(--rf-bg-hover) !important;
    cursor: pointer;
}
.RecordfulDropdownMenuItem[data-disabled] {
  color: var(--rf-text-secondary) !important;
  cursor: not-allowed;
  background-color: var(--rf-bg-hover) !important;
}

`}</style>
    </div>
  );
};

export default Content;
