export const legalConfig = {
  serviceName: "TrimmyCRM",
  website: "https://trimmycrm.ru",
  email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "hello@trimmycrm.ru",
  operatorName:
    process.env.NEXT_PUBLIC_LEGAL_OPERATOR_NAME?.trim() ||
    "Администратор информационного ресурса TrimmyCRM",
  operatorAddress:
    process.env.NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS?.trim() || "Российская Федерация",
  effectiveDate: "2 августа 2026 года",
};
