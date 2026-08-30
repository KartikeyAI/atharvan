import type {
  FieldsetHTMLAttributes,
  HTMLAttributes,
  LabelHTMLAttributes,
} from "react";

export function FieldGroup({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`field-group ${className}`.trim()} {...props} />;
}

export function Field({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`field ${className}`.trim()} {...props} />;
}

export function FieldLabel({
  className = "",
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`label ${className}`.trim()} {...props} />;
}

export function FieldDescription({
  className = "",
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={`field-description ${className}`.trim()} {...props} />;
}

export function FieldSet({
  className = "",
  ...props
}: FieldsetHTMLAttributes<HTMLFieldSetElement>) {
  return <fieldset className={`field-set ${className}`.trim()} {...props} />;
}

export function FieldLegend({
  className = "",
  ...props
}: HTMLAttributes<HTMLLegendElement>) {
  return <legend className={`field-legend ${className}`.trim()} {...props} />;
}
