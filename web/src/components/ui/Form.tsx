'use client';

import * as React from 'react';
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/utils';

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);
const FormItemContext = React.createContext<{ id: string }>({ id: '' });

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();
  const fieldState = getFieldState(fieldContext.name, formState);
  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

const FormItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function FormItem(
  { className, ...props },
  ref,
) {
  const id = React.useId();
  return (
    <FormItemContext.Provider value={{ id }}>
      <div ref={ref} className={cn('space-y-2', className)} {...props} />
    </FormItemContext.Provider>
  );
});

const FormLabel = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  function FormLabel({ className, ...props }, ref) {
    const { error, formItemId } = useFormField();
    return <Label ref={ref} className={cn(error && 'text-rose-300', className)} htmlFor={formItemId} {...props} />;
  },
);

const FormControl = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function FormControl(
  { className, children, ...props },
  ref,
) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();

  if (React.isValidElement(children)) {
    return (
      <div ref={ref} className={className} {...props}>
        {React.cloneElement(children as React.ReactElement, {
          id: formItemId,
          'aria-describedby': error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId,
          'aria-invalid': !!error,
        })}
      </div>
    );
  }

  return (
    <div ref={ref} className={className} {...props}>
      {children}
    </div>
  );
});

const FormDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function FormDescription({ className, ...props }, ref) {
    const { formDescriptionId } = useFormField();
    return <p ref={ref} id={formDescriptionId} className={cn('text-xs leading-6 text-slate-400', className)} {...props} />;
  },
);

const FormMessage = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(function FormMessage(
  { className, children, ...props },
  ref,
) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message || '') : children;

  if (!body) return null;

  return (
    <p ref={ref} id={formMessageId} className={cn('text-xs font-medium text-rose-300', className)} {...props}>
      {body}
    </p>
  );
});

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
};
