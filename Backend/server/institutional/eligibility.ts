/** Binary equality excludes NULL, case variants and trailing spaces. Server SQL only. */
export const eligibleParcelSql = "BINARY p.ESTADO_CRUCE_CATASTRO = BINARY 'EN_CATASTRO'";
