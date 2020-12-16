/*
 * cloudbeaver - Cloud Database Manager
 * Copyright (C) 2020 DBeaver Corp and others
 *
 * Licensed under the Apache License, Version 2.0.
 * you may not use this file except in compliance with the License.
 */

import { observable, computed } from 'mobx';

import {
  injectable, IInitializableController
} from '@cloudbeaver/core-di';
import { NotificationService } from '@cloudbeaver/core-events';
import { Executor, IExecutor } from '@cloudbeaver/core-executor';
import { ConnectionConfig } from '@cloudbeaver/core-sdk';

import { DBDriver, DBDriverResource } from '../../../DBDriverResource';
import { ConnectionsResource, isLocalConnection } from '../../ConnectionsResource';
import { IConnectionFormModel } from './IConnectionFormModel';

interface IValidationStatus {
  status: boolean;
  errorMessage: string;
}
@injectable()
export class ConnectionFormController
implements IInitializableController {
  @observable isSaving: boolean;

  readonly afterSave: IExecutor<string>;

  get isUrlConnection(): boolean {
    if (this.model.editing) {
      return this.model.connection.useUrl;
    }
    return !this.driver?.sampleURL;
  }

  get isDisabled(): boolean {
    return this.isSaving;
  }

  /** It will be loaded by options controller */
  @computed get driver(): DBDriver | null {
    return this.dbDriverResource.get(this.model.connection.driverId) || null;
  }

  private model!: IConnectionFormModel;
  private close!: () => void;

  constructor(
    private connectionsResource: ConnectionsResource,
    private notificationService: NotificationService,
    private dbDriverResource: DBDriverResource
  ) {
    this.isSaving = false;
    this.afterSave = new Executor();
  }

  get local(): boolean {
    return isLocalConnection(this.model.connection);
  }

  init(
    model: IConnectionFormModel,
    close: () => void
  ): void {
    this.model = model;
    this.close = close;
  }

  save = async (): Promise<void> => {
    const connectionConfig = this.getConnectionConfig();
    const validationStatus = this.valdiate(connectionConfig);
    if (!validationStatus.status) {
      this.notificationService.logError({ title: this.model.editing ? 'connections_administration_connection_save_error' : 'connections_administration_connection_create_error', message: validationStatus.errorMessage });
      return;
    }

    this.isSaving = true;
    try {
      if (this.model.editing) {
        const connection = await this.connectionsResource.update(this.model.connection.id, connectionConfig);
        await this.afterSave.execute(connection.id);

        this.notificationService.logSuccess({ title: `Connection ${connection.name} updated` });
      } else {
        connectionConfig.name = this.getUniqueName(connectionConfig.name!);
        const connection = await this.connectionsResource.create(connectionConfig);
        await this.afterSave.execute(connection.id);
        this.close();
        this.notificationService.logSuccess({ title: `Connection ${connection.name} created` });
      }
    } catch (exception) {
      this.notificationService.logException(exception, 'connections_connection_create_fail');
    } finally {
      this.isSaving = false;
    }
  };

  test = async (): Promise<void> => {
    this.isSaving = true;
    try {
      await this.connectionsResource.test(this.getConnectionConfig());
      this.notificationService.logSuccess({ title: 'Connection is established' });
    } catch (exception) {
      this.notificationService.logException(exception, 'connections_connection_test_fail');
    } finally {
      this.isSaving = false;
    }
  };

  private isConnectionNameAlreadyExists(name: string) {
    for (const connection of this.connectionsResource.data.values()) {
      if (connection.id !== this.model.connection.id && connection.name === name) {
        return true;
      }
    }
    return false;
  }

  private valdiate(config: ConnectionConfig) {
    const validateByLength: Array<keyof ConnectionConfig> = ['name'];
    const validationStatus: IValidationStatus = { status: true, errorMessage: '' };

    for (const key of validateByLength) {
      if (!config[key]?.length) {
        validationStatus.errorMessage = `Field '${key}' can't be empty`;
        break;
      }
    }

    if (!validationStatus.errorMessage) {
      if (this.model.editing && this.isConnectionNameAlreadyExists(config.name!)) {
        validationStatus.errorMessage = 'Connection with this name already exists';
      }
    }

    validationStatus.status = !validationStatus.errorMessage;
    return validationStatus;
  }

  private getUniqueName(name: string) {
    let index = 0;
    let nameToCheck = name;

    const connectionsNames = new Set();
    for (const connection of this.connectionsResource.data.values()) {
      if (connection.id !== this.model.connection.id) {
        connectionsNames.add(connection.name);
      }
    }

    while (true) {
      if (!connectionsNames.has(nameToCheck)) {
        break;
      }
      index += 1;
      nameToCheck = `${name} (${index})`;
    }

    return nameToCheck;
  }

  private getConnectionConfig(): ConnectionConfig {
    const config: ConnectionConfig = {};

    if (this.model.editing) {
      config.connectionId = this.model.connection.id;
    }

    config.name = this.model.connection.name;
    config.description = this.model.connection.description;
    config.template = this.model.connection.template;
    config.driverId = this.model.connection.driverId;

    if (!this.isUrlConnection) {
      if (!this.driver?.embedded) {
        config.host = this.model.connection.host;
        config.port = this.model.connection.port;
      }
      config.databaseName = this.model.connection.databaseName;
    } else {
      config.url = this.model.connection.url;
    }
    if (this.model.connection.authModel || this.driver!.defaultAuthModel) {
      config.authModelId = this.model.connection.authModel || this.driver!.defaultAuthModel;
      config.saveCredentials = this.model.connection.saveCredentials;
      if (this.isCredentialsChanged()) {
        config.credentials = this.model.credentials;
      }
    }
    if (Object.keys(this.model.connection.properties).length > 0) {
      config.properties = this.model.connection.properties;
    }

    (Object.keys(config) as Array<keyof ConnectionConfig>).forEach(key => {
      const value = config[key];
      if (value && typeof value === 'string' && value.length) {
        config[key] = value?.trim();
      }
    });

    return config;
  }

  private isCredentialsChanged() {
    if (!this.model.connection.authProperties.length) {
      return true;
    }
    for (const property of this.model.connection.authProperties) {
      const value = this.model.credentials[property.id!];

      if (property.features.includes('password')) {
        if (value) {
          return true;
        }
      } else if (value !== property.value) {
        return true;
      }
    }
    return false;
  }
}
