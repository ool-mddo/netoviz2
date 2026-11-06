import { parseProfiles } from './profileYaml'
import text from './mddoFwProfile.yaml?raw'

/** The profile of mddo-fw (layer1 of original_asis; a copy for the tests of the layout) */
export const mddoFwProfiles = () => Promise.resolve(parseProfiles(text))
