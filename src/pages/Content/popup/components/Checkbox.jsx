import React, { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Minus } from "@phosphor-icons/react";

// Mirrors HeroUI v3 Checkbox architecture (Root/Content/Control/Indicator +
// primary|secondary variants + data-selected/data-indeterminate states), but
// re-implemented on a zero-dep native <input type="checkbox"> instead of
// react-aria / @heroui/react. Source studied:
// packages/react/src/components/checkbox/checkbox.tsx (CheckboxField +
// CheckboxButton primitives, CheckboxGroupContext variant inheritance,
// animated checkmark polyline "1 9 7 14 15 4" dasharray 22) and
// packages/styles/components/checkbox.css (BEM + ::before fill animation).

const CheckboxContext = createContext({});

const cx = (...parts) => parts.filter(Boolean).join(" ");

function CheckmarkIcon({ isSelected }) {
  return (
    <Check
      size={16}
      weight="bold"
      aria-hidden="true"
      style={{
        strokeDasharray: 22,
        strokeDashoffset: isSelected ? 44 : 66,
      }}
    />
  );
}

function IndeterminateIcon() {
  return <Minus size={16} weight="bold" aria-hidden="true" />;
}

export function CheckboxIndicator({ children, className }) {
  const { state } = useContext(CheckboxContext);
  const isSelected = state?.isSelected ?? false;
  const isIndeterminate = state?.isIndeterminate ?? false;

  let content;
  if (typeof children === "function") {
    content = children(state ?? {});
  } else if (children) {
    content = children;
  } else if (isIndeterminate) {
    content = <IndeterminateIcon />;
  } else {
    content = <CheckmarkIcon isSelected={isSelected} />;
  }

  return (
    <span aria-hidden="true" className={cx("checkbox__indicator", className)} data-slot="checkbox-indicator">
      {content}
    </span>
  );
}

export function CheckboxControl({ children, className }) {
  return (
    <span className={cx("checkbox__control", className)} data-slot="checkbox-control">
      {children ?? <CheckboxIndicator />}
    </span>
  );
}

export function CheckboxContent({ children, className }) {
  // Plain wrapper so callers can write HeroUI-style
  // <Checkbox.Content><Checkbox.Control/>label</Checkbox.Content>.
  // The clickable <label> itself lives in Checkbox root.
  return (
    <span className={cx("checkbox__content-inner", className)} data-slot="checkbox-content">
      {children}
    </span>
  );
}

const Checkbox = (props) => {
  const {
    checked: checkedProp,
    isSelected: isSelectedProp,
    defaultChecked,
    defaultSelected: defaultSelectedProp,
    isIndeterminate: indeterminateProp,
    isDisabled: isDisabledProp,
    disabled: disabledProp,
    isRequired: isRequiredProp,
    required: requiredProp,
    isInvalid: isInvalidProp,
    invalid: invalidProp,
    onCheckedChange,
    onChange,
    variant = "primary",
    name,
    value,
    id,
    label,
    description,
    error,
    className,
    controlClassName,
    children,
    ...rest
  } = props;

  const isSelected = checkedProp ?? isSelectedProp;
  const defaultSelected = defaultChecked ?? defaultSelectedProp ?? false;
  const isIndeterminate = indeterminateProp ?? false;
  const isDisabled = isDisabledProp ?? disabledProp ?? false;
  const isRequired = isRequiredProp ?? requiredProp ?? false;
  const isInvalid = isInvalidProp ?? invalidProp ?? false;
  const isControlled = isSelected !== undefined;
  const [internalSelected, setInternalSelected] = useState(defaultSelected);
  const selected = isControlled ? isSelected : internalSelected;
  const inputRef = useRef(null);
  const fallbackId = useId();
  const inputId = id ?? fallbackId;

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = Boolean(isIndeterminate);
    }
  }, [isIndeterminate]);

  const state = {
    isSelected: Boolean(selected),
    isIndeterminate: Boolean(isIndeterminate),
    isDisabled: Boolean(isDisabled),
    isReadOnly: false,
    isInvalid: Boolean(isInvalid),
    isRequired: Boolean(isRequired),
  };

  const handleChange = (e) => {
    const next = e.target.checked;
    if (!isControlled) {
      setInternalSelected(next);
    }
    if (typeof onCheckedChange === "function") {
      onCheckedChange(next);
    }
    // HeroUI Root uses onChange(isSelected: boolean); keep native compat too.
    if (typeof onChange === "function") {
      onChange(next);
    }
  };

  const renderLabel = () => {
    const content = children ?? label;
    if (typeof content === "function") {
      return content(state);
    }
    return content;
  };

  const labelContent = renderLabel();

  return (
    <CheckboxContext.Provider value={{ state }}>
      <span
        className={cx("checkbox", `checkbox--${variant}`, className)}
        data-disabled={isDisabled ? "true" : undefined}
        data-indeterminate={isIndeterminate ? "true" : undefined}
        data-invalid={isInvalid ? "true" : undefined}
        data-selected={selected ? "true" : undefined}
        data-slot="checkbox"
      >
        <label className="checkbox__content" data-slot="checkbox-content" htmlFor={inputId}>
          <input
            ref={inputRef}
            aria-invalid={isInvalid || undefined}
            checked={Boolean(selected)}
            className="checkbox__input"
            disabled={isDisabled}
            id={inputId}
            name={name}
            onChange={handleChange}
            required={isRequired}
            type="checkbox"
            value={value}
            {...rest}
          />
          <CheckboxControl className={controlClassName} />
          {labelContent ? <span data-slot="label">{labelContent}</span> : null}
        </label>
        {description ? <span data-slot="description">{description}</span> : null}
        {error ? <span data-slot="field-error">{error}</span> : null}
      </span>
    </CheckboxContext.Provider>
  );
};

Checkbox.Content = CheckboxContent;
Checkbox.Control = CheckboxControl;
Checkbox.Indicator = CheckboxIndicator;

export default Checkbox;

// Menu variant: thin wrapper over Radix DropdownMenu.CheckboxItem that bakes in
// this repo's repeated boilerplate (prevent-close onSelect, ItemIndicator +
// Phosphor Check). Storage writes stay in the caller, like Switch.jsx does.
export function MenuCheckboxItem({
  checked,
  onCheckedChange,
  children,
  className,
  disabled,
  ...rest
}) {
  return (
    <DropdownMenu.CheckboxItem
      {...rest}
      checked={checked}
      className={cx("DropdownMenuItem", className)}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      onSelect={(e) => {
        e.preventDefault();
      }}
    >
      {children}
      <DropdownMenu.ItemIndicator className="ItemIndicator">
        <Check size={16} weight="bold" aria-hidden="true" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.CheckboxItem>
  );
}
