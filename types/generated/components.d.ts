import type { Attribute, Schema } from '@strapi/strapi';

export interface SharedSeo extends Schema.Component {
  collectionName: 'components_shared_seos';
  info: {
    description: '';
    displayName: 'Seo';
    icon: 'allergies';
    name: 'Seo';
  };
  attributes: {
    metaDescription: Attribute.Text & Attribute.Required;
    metaTitle: Attribute.String & Attribute.Required;
    shareImage: Attribute.Media<'images'>;
  };
}

export interface SharedTag extends Schema.Component {
  collectionName: 'components_shared_tags';
  info: {
    displayName: 'tag';
    icon: 'priceTag';
  };
  attributes: {
    tag: Attribute.String & Attribute.Required;
  };
}

export interface TemplateSupported extends Schema.Component {
  collectionName: 'components_template_supporteds';
  info: {
    displayName: 'supported';
    icon: 'layer';
  };
  attributes: {
    product_logo: Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
    product_name: Attribute.Enumeration<['finebi', 'finereport', 'fvs']> &
      Attribute.Required;
    version: Attribute.String & Attribute.Required;
  };
}

declare module '@strapi/types' {
  export module Shared {
    export interface Components {
      'shared.seo': SharedSeo;
      'shared.tag': SharedTag;
      'template.supported': TemplateSupported;
    }
  }
}
