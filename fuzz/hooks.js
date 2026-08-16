import { getBugDetectorConfiguration } from "@jazzer.js/bug-detectors";

getBugDetectorConfiguration("prototype-pollution")?.instrumentAssignmentsAndVariableDeclarations();
