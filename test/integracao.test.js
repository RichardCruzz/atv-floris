import app from '../src/app.js';
import request from 'supertest';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connection } from '../src/configs/Database.js';
import { consultarCep } from '../src/utils/consultarCep.js';
import { MontadoraFactory } from './factories/MontadoraFactory.js';
import { ClienteFactory } from './factories/ClienteFactory.js';
import { VeiculoFactory } from './factories/VeiculoFactory.js';
import { clearDatabase } from './utils/clearDatabase.js';

// Mock da API externa de CEP (ViaCEP): nenhum teste depende da internet.
vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

// Resposta simulada do ViaCEP para o CEP 01001-000.
const RESPOSTA_VIACEP = {
    data: {
        logradouro: 'Praça da Sé',
        bairro: 'Sé',
        localidade: 'São Paulo',
        uf: 'SP'
    }
};

// Helpers para consultar o banco de testes diretamente.
async function listar(tabela) {
    const [rows] = await connection.execute(`SELECT * FROM ${tabela}`);
    return rows;
}

async function buscarPorId(tabela, id) {
    const [rows] = await connection.execute(`SELECT * FROM ${tabela} WHERE Id = ?`, [id]);
    return rows[0];
}

/* ------------------------------------------------------------------ */
/* Suíte: Clientes (CT-001 a CT-006)                                  */
/* ------------------------------------------------------------------ */
describe('API de clientes', () => {
    afterEach(async () => {
        await clearDatabase();

        vi.resetAllMocks();
    });

    it('CT-001 - deve cadastrar um cliente com dados válidos e retornar 201.', async () => {
        axios.get.mockResolvedValueOnce(RESPOSTA_VIACEP);

        const response = await request(app)
            .post('/clientes')
            .send({
                nome: 'Maria Silva',
                cpf: '123.456.789-00',
                cep: '01001-000',
                numero: '100',
                complemento: 'Apto 1'
            });

        expect(response.status).toBe(201);
        expect(axios.get).toHaveBeenCalledWith('https://viacep.com.br/ws/01001000/json/');

        const clientes = await listar('clientes');
        expect(clientes).toHaveLength(1);
        expect(clientes[0].CPF).toBe('12345678900');
        expect(clientes[0].Logradouro).toBe('Praça da Sé');
        expect(clientes[0].Cidade).toBe('São Paulo');
    });

    it('CT-002 - não deve cadastrar um cliente sem nome.', async () => {
        axios.get.mockResolvedValueOnce(RESPOSTA_VIACEP);

        const response = await request(app)
            .post('/clientes')
            .send({
                cpf: '123.456.789-00',
                cep: '01001-000',
                numero: '100'
            });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Nome inválido');
        expect(await listar('clientes')).toHaveLength(0);
    });

    it('CT-003 - não deve cadastrar um cliente com CPF duplicado.', async () => {
        await ClienteFactory.create(
            'João Souza', '12345678900', '01001000',
            'Rua A', 'Centro', 'São Paulo', 'SP', '10', null
        );
        axios.get.mockResolvedValueOnce(RESPOSTA_VIACEP);

        const response = await request(app)
            .post('/clientes')
            .send({
                nome: 'João Souza Duplicado',
                cpf: '123.456.789-00',
                cep: '01001-000',
                numero: '11'
            });

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.body.message).toBeDefined();

        const clientes = await listar('clientes');
        expect(clientes.filter(c => c.CPF === '12345678900')).toHaveLength(1);
    });

    it('CT-004 - deve consultar um cliente existente e retornar os dados corretos.', async () => {
        await ClienteFactory.create(
            'Ana Lima', '11122233344', '01001000',
            'Rua B', 'Centro', 'São Paulo', 'SP', '20', null
        );
        const cliente = await ClienteFactory.create(
            'João Souza', '98765432100', '01001000',
            'Rua A', 'Centro', 'São Paulo', 'SP', '10', null
        );

        const response = await request(app).get('/clientes');

        expect(response.status).toBe(200);

        const encontrado = response.body.data.find(c => c.Id === cliente.id);
        expect(encontrado).toBeDefined();
        expect(encontrado.Nome).toBe('João Souza');
        expect(encontrado.CPF).toBe('98765432100');
        expect(encontrado.Cidade).toBe('São Paulo');
    });

    it('CT-005 - deve atualizar os dados de um cliente existente.', async () => {
        const cliente = await ClienteFactory.create(
            'João Souza', '98765432100', '01001000',
            'Rua A', 'Centro', 'São Paulo', 'SP', '10', null
        );
        axios.get.mockResolvedValueOnce({
            data: {
                logradouro: 'Avenida Paulista',
                bairro: 'Bela Vista',
                localidade: 'São Paulo',
                uf: 'SP'
            }
        });

        const response = await request(app)
            .put(`/clientes?id=${cliente.id}`)
            .send({
                nome: 'João Souza Atualizado',
                cpf: '987.654.321-00',
                cep: '01310-100',
                numero: '1000',
                complemento: 'Sala 5'
            });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Cliente atualizado com sucesso');
        expect(axios.get).toHaveBeenCalledWith('https://viacep.com.br/ws/01310100/json/');

        const atualizado = await buscarPorId('clientes', cliente.id);
        expect(atualizado.Nome).toBe('João Souza Atualizado');
        expect(atualizado.CEP).toBe('01310100');
        expect(atualizado.Logradouro).toBe('Avenida Paulista');
        expect(atualizado.Numero).toBe('1000');
        expect(atualizado.Complemento).toBe('Sala 5');
    });

    it('CT-006 - deve retornar 404 ao excluir um cliente inexistente.', async () => {
        const response = await request(app).delete('/clientes/999999');

        expect(response.status).toBe(404);
        expect(response.body.message).toMatch(/não encontrad/i);
    });
});

/* ------------------------------------------------------------------ */
/* Suíte: Montadoras (CT-007 a CT-009)                                */
/* ------------------------------------------------------------------ */
describe('API de montadoras', () => {
    let montadora;

    beforeEach(async () => {
        montadora = await MontadoraFactory.create('Toyota', 'Japão');
    });

    afterEach(async () => {
        await clearDatabase();

        vi.resetAllMocks();
    });

    it('CT-007 - deve cadastrar uma montadora válida.', async () => {
        const response = await request(app)
            .post('/montadoras')
            .send({ nome: 'Hyundai', pais: 'Coreia do Sul' });

        expect(response.status).toBe(201);
        expect(response.body.data).toHaveProperty('insertId');

        const criada = await buscarPorId('montadoras', response.body.data.insertId);
        expect(criada.Nome).toBe('Hyundai');
        expect(criada.Pais).toBe('Coreia do Sul');
    });

    it('CT-008 - não deve cadastrar uma montadora sem nome.', async () => {
        const response = await request(app)
            .post('/montadoras')
            .send({ pais: 'Japão' });

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Nome inválido');

        // Apenas a Toyota criada no beforeEach deve existir.
        expect(await listar('montadoras')).toHaveLength(1);
    });

    it('CT-009 - deve consultar a montadora cadastrada.', async () => {
        const response = await request(app).get('/montadoras');

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].Id).toBe(montadora.id);
        expect(response.body.data[0].Nome).toBe('Toyota');
        expect(response.body.data[0].Pais).toBe('Japão');
    });
});

/* ------------------------------------------------------------------ */
/* Suíte: Veículos (CT-010 a CT-015)                                  */
/* ------------------------------------------------------------------ */
describe('API de veículos', () => {
    let montadora;
    let cliente;

    const dadosVeiculo = (extra = {}) => ({
        idMontadora: montadora.id,
        idCliente: cliente.id,
        modelo: 'Corolla',
        placa: 'ABC1D23',
        ano: 2020,
        cor: 'Preto',
        valor: 98000,
        ...extra
    });

    const criarVeiculo = () => VeiculoFactory.create(
        'Corolla', 'ABC1D23', 2020, 'Preto', 98000, cliente.id, montadora.id
    );

    beforeEach(async () => {
        montadora = await MontadoraFactory.create('Toyota', 'Japão');
        cliente = await ClienteFactory.create(
            'Ana Lima', '11122233344', '01001000',
            'Rua B', 'Centro', 'São Paulo', 'SP', '20', null
        );
    });

    afterEach(async () => {
        await clearDatabase();
    });

    it('CT-010 - deve cadastrar um veículo com dados válidos.', async () => {
        const response = await request(app)
            .post('/veiculos')
            .send(dadosVeiculo());

        expect(response.status).toBe(201);
        expect(response.body.data).toHaveProperty('insertId');

        const criado = await buscarPorId('veiculos', response.body.data.insertId);
        expect(criado.Modelo).toBe('Corolla');
        expect(criado.IdMontadora).toBe(montadora.id);
        expect(criado.IdCliente).toBe(cliente.id);
        expect(Number(criado.Valor)).toBe(98000);
    });

    it('CT-011 - não deve cadastrar um veículo com ano inválido.', async () => {
        const response = await request(app)
            .post('/veiculos')
            .send(dadosVeiculo({ ano: 1800 }));

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Ano inválido');
        expect(await listar('veiculos')).toHaveLength(0);
    });

    it('CT-012 - não deve cadastrar um veículo sem montadora.', async () => {
        // idMontadora undefined é omitido na serialização do JSON.
        const response = await request(app)
            .post('/veiculos')
            .send(dadosVeiculo({ idMontadora: undefined }));

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('ID da montadora inválido');
        expect(await listar('veiculos')).toHaveLength(0);
    });

    it('CT-013 - deve consultar um veículo existente com os dados completos.', async () => {
        const veiculo = await criarVeiculo();

        const response = await request(app).get('/veiculos');

        expect(response.status).toBe(200);

        const encontrado = response.body.data.find(v => v.Id === veiculo.id);
        expect(encontrado).toBeDefined();
        expect(encontrado.Modelo).toBe('Corolla');
        expect(encontrado.Placa).toBe('ABC1D23');
        expect(encontrado.Ano).toBe(2020);
        expect(encontrado.Cor).toBe('Preto');
        expect(Number(encontrado.Valor)).toBe(98000);
        expect(encontrado.Montadora).toBe('Toyota');
        expect(encontrado.Cliente).toBe('Ana Lima');
    });

    it('CT-014 - deve atualizar um veículo sem perder o identificador.', async () => {
        const veiculo = await criarVeiculo();

        const response = await request(app)
            .put(`/veiculos?id=${veiculo.id}`)
            .send(dadosVeiculo({ modelo: 'Corolla XEi', ano: 2021, cor: 'Branco', valor: 105000 }));

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Veículo atualizado com sucesso');

        const veiculos = await listar('veiculos');
        expect(veiculos).toHaveLength(1);

        const atualizado = await buscarPorId('veiculos', veiculo.id);
        expect(atualizado.Id).toBe(veiculo.id);
        expect(atualizado.Modelo).toBe('Corolla XEi');
        expect(atualizado.Ano).toBe(2021);
        expect(atualizado.Cor).toBe('Branco');
        expect(Number(atualizado.Valor)).toBe(105000);
    });

    it('CT-015 - deve excluir um veículo existente e não listá-lo em nova consulta.', async () => {
        const veiculo = await criarVeiculo();

        const response = await request(app).delete(`/veiculos/${veiculo.id}`);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Veículo deletado com sucesso');

        const consulta = await request(app).get('/veiculos');
        expect(consulta.status).toBe(200);
        expect(consulta.body.data.find(v => v.Id === veiculo.id)).toBeUndefined();
    });
});

/* ------------------------------------------------------------------ */
/* Suíte: Integração e Mock (CT-016 a CT-018)                         */
/* Testa a função consultarCep isolada, com o axios mockado.          */
/* ------------------------------------------------------------------ */
describe('Consulta de CEP com mock da API ViaCEP', () => {
    afterEach(() => {
        vi.resetAllMocks();
    });

    it('CT-016 - deve retornar o endereço conforme a resposta simulada de um CEP válido.', async () => {
        axios.get.mockResolvedValueOnce(RESPOSTA_VIACEP);

        const endereco = await consultarCep('01001-000');

        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(axios.get).toHaveBeenCalledWith('https://viacep.com.br/ws/01001000/json/');
        expect(endereco).toEqual({
            cep: '01001000',
            logradouro: 'Praça da Sé',
            bairro: 'Sé',
            cidade: 'São Paulo',
            uf: 'SP'
        });
    });

    it('CT-017 - deve tratar corretamente um CEP inexistente (erro=true).', async () => {
        axios.get.mockResolvedValueOnce({ data: { erro: true } });

        await expect(consultarCep('99999-999')).rejects.toThrow('CEP não encontrado');
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('CT-018 - deve propagar de forma controlada uma falha de conexão com a API ViaCEP.', async () => {
        axios.get.mockRejectedValueOnce(new Error('Network Error'));

        await expect(consultarCep('01001000')).rejects.toThrow('Network Error');
        expect(axios.get).toHaveBeenCalledTimes(1);
    });
});

/* ------------------------------------------------------------------ */
/* Suíte: Integração com banco (CT-019)                               */
/* ------------------------------------------------------------------ */
describe('Integração com o banco de testes', () => {
    afterEach(async () => {
        await clearDatabase();
    });

    it('CT-019 - deve listar os veículos do banco de teste em JSON com status 200.', async () => {
        const montadora = await MontadoraFactory.create('Toyota', 'Japão');
        const cliente = await ClienteFactory.create(
            'Ana Lima', '11122233344', '01001000',
            'Rua B', 'Centro', 'São Paulo', 'SP', '20', null
        );
        await VeiculoFactory.create('Corolla', 'ABC1D23', 2020, 'Preto', 98000, cliente.id, montadora.id);
        await VeiculoFactory.create('Etios', 'DEF4G56', 2019, 'Prata', 52000, cliente.id, montadora.id);

        const response = await request(app).get('/veiculos');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/application\/json/);
        expect(Array.isArray(response.body.data)).toBe(true);
        expect(response.body.data).toHaveLength(2);
        // A consulta ordena por modelo.
        expect(response.body.data.map(v => v.Modelo)).toEqual(['Corolla', 'Etios']);
    });
});

/* ------------------------------------------------------------------ */
/* Suíte: Tratamento de erros (CT-020)                                */
/* ------------------------------------------------------------------ */
describe('Tratamento de erros da API', () => {
    afterEach(async () => {
        await clearDatabase();
    });

    it('CT-020 - deve retornar erro 500 em uma falha do banco sem encerrar o servidor.', async () => {
        // Montadora e cliente inexistentes: o INSERT viola as chaves estrangeiras.
        const response = await request(app)
            .post('/veiculos')
            .send({
                idMontadora: 999999,
                idCliente: 999999,
                modelo: 'Corolla',
                placa: 'ABC1D23',
                ano: 2020,
                cor: 'Preto',
                valor: 98000
            });

        expect(response.status).toBe(500);
        expect(response.body.message).toBe('Erro ao criar veículo');
        expect(response.body.error).toBeTruthy();
        expect(await listar('veiculos')).toHaveLength(0);

        // A API continua respondendo normalmente após o erro.
        const proximaRequisicao = await request(app).get('/montadoras');
        expect(proximaRequisicao.status).toBe(200);
    });
});
