const mdfePayload = {
  tipoAmbiente: 1, // Prod
  tipoEmitente: 2, // Transportador
  ufCarregamento: 'PR',
  ufDescarregamento: 'RJ',
  modalidade: 1,
  valor: 0,
  peso: 0,
  percursoUfs: undefined,
  Rodoviario: {
    tipoRodado: 3,
    tipoCarroceria: 2,
    placa: '',
    renavam: '00000000000',
    tara: 0,
    capKG: 0,
    capM3: 0,
    uf: 'PR',
    condutores: [{ nome: 'Motorista', cpf: '00000000000' }],
    reboques: undefined
  },
  carregamentos: [
    { codMunicipio: 4118204, municipio: "Origem" }
  ],
  descarregamentos: [{ codMunicipio: 3304557, municipio: "Destino", chaveDfe: "12345678901234567890123456789012345678901234" }],
  produtoPredominante: {
    tpCarga: 5,
    descricao: "Madeira",
    cEan: "SEM GTIN",
    ncm: "44123900"
  }
};
console.log(JSON.stringify(mdfePayload, null, 2));
