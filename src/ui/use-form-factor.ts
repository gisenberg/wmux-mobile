import { useWindowDimensions } from "react-native";

import { formFactorForWidth, type FormFactor } from "@/ui/layout";

export const useFormFactor = (): FormFactor => formFactorForWidth(useWindowDimensions().width);
