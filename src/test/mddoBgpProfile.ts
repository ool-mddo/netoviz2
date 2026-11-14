import { parseProfiles } from './profileYaml'
import text from './mddoBgpProfile.yaml?raw'

/** The profile of mddo-bgp (layer3 of emulated_asis; a copy of playground's profiles/mddo-bgp/asis.yaml for the tests) */
export const mddoBgpProfiles = () => Promise.resolve(parseProfiles(text))
